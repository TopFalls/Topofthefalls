-- Give the admin a Remove that actually removes.
--
-- Carl: "When I remove players still keeps them as inactive rather then
-- removing them." He was reading it exactly right. There was no Remove. The
-- only control on the Players tab is a Deactivate/Activate toggle, which sets
-- players.is_active = false and leaves everything else alone -- the player keeps
-- their ladder position and stays visible to the whole league, and to
-- signed-out visitors, struck through. Fourteen names were sitting in that
-- state.
--
-- Deactivate is a real and separate thing, and it stays: a player taking a
-- break keeps their spot and comes back to it. What was missing is the other
-- one -- somebody who is done, or a name that should never have been on the
-- list.
--
-- What "removed" means depends on whether they ever played, and the function
-- decides that rather than the admin:
--
--   no history  -> the row is deleted outright and the ladder closes up behind
--                  them. Cascades take rankings, discipline stats, reference
--                  metrics, push subscriptions and admin alerts; season stats,
--                  feed entries, notifications and cooldowns are cleared first
--                  because those foreign keys are NO ACTION.
--   any history -> the row stays and is marked removed_at, off the ladder and
--                  out of every list. Their finished matches are half of
--                  somebody else's win-loss record; deleting them would quietly
--                  change another player's numbers.
--
-- Every removal is snapshotted first, so it can be undone. That is what keeps
-- this out of stop-condition territory: the pattern is the one
-- 20260806121000_admin_stats_reset.sql already established for stats.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

COMMENT ON COLUMN public.players.removed_at IS
  'Set when an admin removed a player who had history worth keeping. Removed players hold no rankings row and are filtered out of public_players. Distinct from is_active=false, which is a player on a break who keeps their spot.';

-- Dropping the rankings row takes a removed player off the ladder, but not out
-- of the guest-readable player list: public_players had no WHERE clause at all,
-- and the base table policy is "Anyone can view players" USING (true). Without
-- this, a removed player who kept their history stays visible everywhere except
-- the ladder -- which is precisely the complaint this change exists to answer.
--
-- Same columns in the same order, so this is a genuine REPLACE: it keeps the
-- view's owner, its grants, and the security_definer behaviour the six guest
-- views deliberately rely on. It only narrows what comes back.
CREATE OR REPLACE VIEW public.public_players AS
  SELECT id,
         profile_id,
         full_name,
         is_active,
         created_at,
         updated_at,
         bio,
         preferred_discipline,
         avatar_url,
         inactive_since,
         inactive_drift_periods
    FROM public.players p
   WHERE p.removed_at IS NULL;

-- ─── The undo ────────────────────────────────────────────────────────────────

-- No foreign key on player_id: for a clean removal the player row is gone, and
-- the whole point of this table is to still hold what it was.
CREATE TABLE IF NOT EXISTS public.player_removal_events (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id         uuid NOT NULL,
  full_name         text NOT NULL,
  hard_deleted      boolean NOT NULL,
  ranking_position  integer,
  snapshot          jsonb NOT NULL,
  -- ON DELETE SET NULL, matching stats_reset_events: profiles cascades from
  -- auth.users, and a NO ACTION reference here would abort the deletion of any
  -- admin account that had ever removed somebody.
  performed_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  restored_at       timestamptz,
  restored_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.player_removal_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.player_removal_events'::regclass
      AND polname = 'Admins can view player removal events'
  ) THEN
    CREATE POLICY "Admins can view player removal events"
      ON public.player_removal_events FOR SELECT
      USING (public.is_league_admin());
  END IF;
END $$;

REVOKE ALL ON TABLE public.player_removal_events FROM anon;
GRANT SELECT ON public.player_removal_events TO authenticated;
GRANT ALL ON public.player_removal_events TO service_role;

-- ─── Remove ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_remove_player(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p          public.players%ROWTYPE;
  v_pos        integer;
  v_live       integer;
  v_matches    integer;
  v_challenges integer;
  v_treasury   integer;
  v_forfeits   integer;
  v_hard       boolean;
  v_snapshot   jsonb;
BEGIN
  IF NOT public.is_league_admin() THEN
    RAISE EXCEPTION 'admin_remove_player: admin role required';
  END IF;

  SELECT * INTO v_p FROM public.players WHERE id = p_player_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found';
  END IF;
  IF v_p.removed_at IS NOT NULL THEN
    RAISE EXCEPTION '% has already been removed from the list.', v_p.full_name;
  END IF;

  -- An open challenge would be left pointing at somebody who is not on the
  -- list. Make the admin deal with it deliberately rather than orphaning it.
  --
  -- Only the four statuses challenges are actually written to while live.
  -- 'confirming' is a matches status and never appears here; a challenge sits
  -- at 'in_progress' for the whole submit/confirm/dispute window. The unplayed
  -- match is checked separately rather than inferred, so the two definitions of
  -- "tied up" cannot drift apart.
  SELECT count(*) INTO v_live
  FROM public.challenges
  WHERE (challenger_id = p_player_id OR challenged_id = p_player_id)
    AND status IN ('pending', 'accepted', 'scheduled', 'in_progress');
  IF v_live = 0 THEN
    SELECT count(*) INTO v_live
    FROM public.matches
    WHERE (player1_id = p_player_id OR player2_id = p_player_id)
      AND status IN ('scheduled', 'in_progress', 'submitted', 'confirming', 'disputed');
  END IF;
  IF v_live > 0 THEN
    RAISE EXCEPTION '% still has % unfinished match or challenge. Cancel or finish that first, then remove.',
      v_p.full_name, v_live;
  END IF;

  SELECT count(*) INTO v_matches    FROM public.matches
    WHERE player1_id = p_player_id OR player2_id = p_player_id;
  SELECT count(*) INTO v_challenges FROM public.challenges
    WHERE challenger_id = p_player_id OR challenged_id = p_player_id;
  SELECT count(*) INTO v_treasury   FROM public.treasury_ledger
    WHERE player_id = p_player_id;
  SELECT count(*) INTO v_forfeits   FROM public.challenge_forfeiture_events
    WHERE challenger_id = p_player_id OR forfeiting_player_id = p_player_id
       OR winner_id = p_player_id OR loser_id = p_player_id;

  v_hard := (v_matches = 0 AND v_challenges = 0 AND v_treasury = 0 AND v_forfeits = 0);

  -- Lock before reading the position, not after. Every other ranking mutator in
  -- this schema does the same (admin_reorder_rankings, drop_player_spots) for
  -- the reason 20260517035337_serialize_ranking_mutations.sql gives: a ladder
  -- swap or drift drop committing between the read and the shift would leave
  -- v_pos stale, and the shift would then close the wrong gap.
  LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE;

  SELECT position INTO v_pos FROM public.rankings WHERE player_id = p_player_id;

  -- Snapshot everything before a single row moves.
  v_snapshot := jsonb_build_object(
    'player',           to_jsonb(v_p),
    'ranking',          (SELECT to_jsonb(r) FROM public.rankings r WHERE r.player_id = p_player_id),
    'season_stats',     (SELECT jsonb_agg(to_jsonb(s)) FROM public.player_season_stats s WHERE s.player_id = p_player_id),
    'discipline_stats', (SELECT jsonb_agg(to_jsonb(d)) FROM public.player_discipline_stats d WHERE d.player_id = p_player_id),
    'activity_feed',    (SELECT jsonb_agg(to_jsonb(a)) FROM public.activity_feed a WHERE a.actor_player_id = p_player_id),
    'notifications',    (SELECT jsonb_agg(to_jsonb(n)) FROM public.notifications n WHERE n.player_id = p_player_id),
    'cooldowns',        (SELECT jsonb_agg(to_jsonb(c)) FROM public.cooldowns c WHERE c.player_id = p_player_id),
    'counts',           jsonb_build_object('matches', v_matches, 'challenges', v_challenges,
                                           'treasury_entries', v_treasury, 'forfeits', v_forfeits)
  );

  INSERT INTO public.player_removal_events
    (player_id, full_name, hard_deleted, ranking_position, snapshot, performed_by)
  VALUES (p_player_id, v_p.full_name, v_hard, v_pos, v_snapshot, auth.uid());

  -- Off the ladder, and close the hole behind them. rankings.position carries a
  -- non-deferrable UNIQUE, so the shift goes out of the way and back again --
  -- the same two-phase move admin_reorder_rankings uses.
  DELETE FROM public.rankings WHERE player_id = p_player_id;

  IF v_pos IS NOT NULL THEN
    UPDATE public.rankings SET position = position + 1000 WHERE position > v_pos;
    UPDATE public.rankings SET position = position - 1001, updated_at = now() WHERE position > 1000;
  END IF;

  IF v_hard THEN
    DELETE FROM public.notifications      WHERE player_id = p_player_id;
    DELETE FROM public.cooldowns          WHERE player_id = p_player_id;
    DELETE FROM public.activity_feed      WHERE actor_player_id = p_player_id;
    DELETE FROM public.player_season_stats WHERE player_id = p_player_id;
    DELETE FROM public.players            WHERE id = p_player_id;
  ELSE
    UPDATE public.players
    SET removed_at = now(), is_active = false, updated_at = now()
    WHERE id = p_player_id;
  END IF;

  -- actor_player_id only survives the soft path; on the hard path that player
  -- no longer exists and the foreign key would refuse it.
  INSERT INTO public.activity_feed (event_type, headline, detail, actor_player_id)
  VALUES (
    'player_removed',
    v_p.full_name || ' was removed from the list.',
    CASE WHEN v_hard
      THEN 'No matches on record, so the name is gone entirely and the list closed up.'
      ELSE 'Off the list. Their finished matches stay, so opponent records are unchanged.'
    END,
    CASE WHEN v_hard THEN NULL ELSE p_player_id END
  );

  INSERT INTO public.audit_events (actor_profile_id, action, target_type, target_id, detail)
  VALUES (
    auth.uid(), 'player.removed', 'player', p_player_id,
    jsonb_build_object(
      'full_name',         v_p.full_name,
      'hard_deleted',      v_hard,
      'previous_position', v_pos,
      'matches',           v_matches,
      'challenges',        v_challenges,
      'treasury_entries',  v_treasury,
      'forfeits',          v_forfeits
    )
  );

  RETURN jsonb_build_object(
    'removed',           true,
    'hard_deleted',      v_hard,
    'full_name',         v_p.full_name,
    'previous_position', v_pos,
    'matches',           v_matches
  );
END;
$$;

COMMENT ON FUNCTION public.admin_remove_player(uuid) IS
  'Admin-only: take a player off the list for good. Deletes outright when they have no history, otherwise keeps the row and marks removed_at so opponent records stay correct. Snapshots first; refuses while a challenge is open.';

REVOKE ALL ON FUNCTION public.admin_remove_player(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remove_player(uuid) TO authenticated;

-- ─── Undo ────────────────────────────────────────────────────────────────────
--
-- The snapshot above is only worth taking if something can read it back. This
-- is what keeps a delete out of stop-condition territory, so it ships in the
-- same migration rather than being left as a follow-up.

CREATE OR REPLACE FUNCTION public.admin_restore_player(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e     public.player_removal_events%ROWTYPE;
  v_snap  jsonb;
  v_pos   integer;
  v_max   integer;
  v_pid   uuid;
BEGIN
  IF NOT public.is_league_admin() THEN
    RAISE EXCEPTION 'admin_restore_player: admin role required';
  END IF;

  SELECT * INTO v_e FROM public.player_removal_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Removal not found';
  END IF;
  IF v_e.restored_at IS NOT NULL THEN
    RAISE EXCEPTION '% was already put back on %.', v_e.full_name, v_e.restored_at::date;
  END IF;

  v_snap := v_e.snapshot;
  v_pid  := v_e.player_id;

  IF v_e.hard_deleted THEN
    IF EXISTS (SELECT 1 FROM public.players WHERE id = v_pid) THEN
      RAISE EXCEPTION '% is already back on the list.', v_e.full_name;
    END IF;
    -- The snapshot was taken before removal, so the row it rebuilds already
    -- carries the right is_active and a null removed_at. Do not overwrite
    -- is_active here: somebody deactivated and then removed should come back
    -- deactivated, not active.
    INSERT INTO public.players SELECT * FROM jsonb_populate_record(NULL::public.players, v_snap->'player');
    UPDATE public.players SET removed_at = NULL, updated_at = now() WHERE id = v_pid;

    INSERT INTO public.player_season_stats
      SELECT * FROM jsonb_populate_recordset(NULL::public.player_season_stats, COALESCE(v_snap->'season_stats', '[]'::jsonb));
    INSERT INTO public.player_discipline_stats
      SELECT * FROM jsonb_populate_recordset(NULL::public.player_discipline_stats, COALESCE(v_snap->'discipline_stats', '[]'::jsonb));
    INSERT INTO public.activity_feed
      SELECT * FROM jsonb_populate_recordset(NULL::public.activity_feed, COALESCE(v_snap->'activity_feed', '[]'::jsonb));
    INSERT INTO public.notifications
      SELECT * FROM jsonb_populate_recordset(NULL::public.notifications, COALESCE(v_snap->'notifications', '[]'::jsonb));
    INSERT INTO public.cooldowns
      SELECT * FROM jsonb_populate_recordset(NULL::public.cooldowns, COALESCE(v_snap->'cooldowns', '[]'::jsonb));
  ELSE
    UPDATE public.players
    SET removed_at = NULL,
        is_active  = COALESCE((v_snap->'player'->>'is_active')::boolean, true),
        updated_at = now()
    WHERE id = v_pid;
  END IF;

  -- Back onto the ladder. The list has probably moved since, so land them at
  -- their old spot or the bottom, whichever is reachable, and push the rest
  -- down using the same two-phase shift the removal used.
  IF NOT EXISTS (SELECT 1 FROM public.rankings WHERE player_id = v_pid) THEN
    LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE;
    SELECT COALESCE(max(position), 0) INTO v_max FROM public.rankings;
    v_pos := LEAST(COALESCE(v_e.ranking_position, v_max + 1), v_max + 1);

    UPDATE public.rankings SET position = position + 1000 WHERE position >= v_pos;
    UPDATE public.rankings SET position = position - 999, updated_at = now() WHERE position > 1000;

    INSERT INTO public.rankings (player_id, position, previous_position)
    VALUES (v_pid, v_pos, NULLIF(v_e.ranking_position, v_pos));
  ELSE
    -- Already holds a spot somehow. Report where they are rather than leaving
    -- v_pos null, which would blank the feed line it is concatenated into.
    SELECT position INTO v_pos FROM public.rankings WHERE player_id = v_pid;
  END IF;

  UPDATE public.player_removal_events
  SET restored_at = now(), restored_by = auth.uid()
  WHERE id = p_event_id;

  INSERT INTO public.activity_feed (event_type, headline, detail, actor_player_id)
  VALUES ('player_restored',
          v_e.full_name || ' is back on the list.',
          'An admin reversed the removal. Back in at number ' || v_pos || '.',
          v_pid);

  INSERT INTO public.audit_events (actor_profile_id, action, target_type, target_id, detail)
  VALUES (auth.uid(), 'player.restored', 'player', v_pid,
    jsonb_build_object('full_name', v_e.full_name, 'removal_event_id', p_event_id,
                       'hard_deleted', v_e.hard_deleted, 'restored_position', v_pos));

  RETURN jsonb_build_object('restored', true, 'full_name', v_e.full_name, 'position', v_pos);
END;
$$;

COMMENT ON FUNCTION public.admin_restore_player(uuid) IS
  'Admin-only: reverse an admin_remove_player, rebuilding the player and their ladder spot from the snapshot taken at removal.';

REVOKE ALL ON FUNCTION public.admin_restore_player(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_restore_player(uuid) TO authenticated;
