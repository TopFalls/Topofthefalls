-- Admin stats reset, with snapshot and one-click restore.
--
-- Carl needs to zero a player's record (or the whole league's) at season
-- rollover or after a scoring mistake. Two modes, because the counters and the
-- visible match history are separate things:
--
--   keep_history = true   Zero the counters only. Match History still lists
--                         every past match. Useful for correcting a bad stat
--                         without erasing the record of what was played.
--   keep_history = false  Zero the counters AND stamp stats_reset_at, which the
--                         app uses to hide matches completed before the reset.
--                         This is the "new season" option — profiles stay
--                         internally consistent instead of showing 0 wins above
--                         a list of wins.
--
-- Ladder positions are deliberately NOT touched: admins already reorder the
-- ladder directly via admin_reorder_rankings (20260703120000).
--
-- Every reset snapshots the full prior state into stats_reset_events, so a
-- mistaken league-wide wipe is one call away from being undone. Matches are
-- never deleted — stats_reset_at only filters what the player-facing view
-- shows, so dispute history and the treasury trail stay intact.

-- 1. When this player's stats were last reset. NULL = never.
ALTER TABLE public.player_season_stats
  ADD COLUMN IF NOT EXISTS stats_reset_at timestamptz;

-- 2. Snapshot store. One row per reset action.
CREATE TABLE IF NOT EXISTS public.stats_reset_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope text NOT NULL CHECK (scope IN ('player', 'league')),
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  kept_history boolean NOT NULL,
  season_snapshot jsonb NOT NULL,
  discipline_snapshot jsonb NOT NULL,
  player_count integer NOT NULL,
  performed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restored_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT player_scope_requires_player
    CHECK ((scope = 'player' AND player_id IS NOT NULL)
        OR (scope = 'league' AND player_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_stats_reset_events_created
  ON public.stats_reset_events(created_at DESC);

ALTER TABLE public.stats_reset_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view stats reset events" ON public.stats_reset_events;
CREATE POLICY "Admins can view stats reset events"
  ON public.stats_reset_events FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (select auth.uid()) AND role IN ('admin', 'super_admin')
  ));

REVOKE ALL ON TABLE public.stats_reset_events FROM anon;
GRANT SELECT ON public.stats_reset_events TO authenticated;
GRANT ALL ON public.stats_reset_events TO service_role;

-- 3. Perform a reset.
--    p_player_id NULL  -> whole league
--    p_keep_history    -> true keeps Match History visible
CREATE OR REPLACE FUNCTION public.admin_reset_stats(
  p_player_id uuid DEFAULT NULL,
  p_keep_history boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_scope text;
  v_season jsonb;
  v_discipline jsonb;
  v_count integer;
  v_event_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'admin_reset_stats: admin role required';
  END IF;

  v_scope := CASE WHEN p_player_id IS NULL THEN 'league' ELSE 'player' END;

  IF p_player_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_player_id) THEN
    RAISE EXCEPTION 'admin_reset_stats: player % not found', p_player_id;
  END IF;

  -- Snapshot BEFORE mutating, so restore is exact.
  SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb), count(*)
  INTO v_season, v_count
  FROM public.player_season_stats s
  WHERE p_player_id IS NULL OR s.player_id = p_player_id;

  SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
  INTO v_discipline
  FROM public.player_discipline_stats d
  WHERE p_player_id IS NULL OR d.player_id = p_player_id;

  INSERT INTO public.stats_reset_events(
    scope, player_id, kept_history, season_snapshot, discipline_snapshot,
    player_count, performed_by
  )
  VALUES (
    v_scope, p_player_id, p_keep_history, v_season, v_discipline,
    v_count, auth.uid()
  )
  RETURNING id INTO v_event_id;

  UPDATE public.player_season_stats
  SET wins = 0,
      losses = 0,
      points = 0,
      current_streak = 0,
      best_streak = 0,
      matches_played = 0,
      forfeits = 0,
      forfeit_wins = 0,
      challenger_wins = 0,
      defender_wins = 0,
      best_rank_achieved = NULL,
      stats_reset_at = CASE WHEN p_keep_history THEN stats_reset_at ELSE now() END,
      updated_at = now()
  WHERE p_player_id IS NULL OR player_id = p_player_id;

  UPDATE public.player_discipline_stats
  SET wins = 0,
      losses = 0,
      points = 0,
      current_streak = 0,
      best_streak = 0,
      matches_played = 0,
      forfeits = 0,
      forfeit_wins = 0,
      challenger_wins = 0,
      defender_wins = 0,
      challenges_issued = 0,
      challenges_received = 0,
      total_race_length = 0,
      updated_at = now()
  WHERE p_player_id IS NULL OR player_id = p_player_id;

  INSERT INTO public.audit_events(actor_profile_id, action, target_type, target_id, detail)
  VALUES (
    auth.uid(),
    'stats.reset',
    CASE WHEN p_player_id IS NULL THEN 'league' ELSE 'player' END,
    p_player_id,
    jsonb_build_object(
      'event_id', v_event_id,
      'scope', v_scope,
      'kept_history', p_keep_history,
      'players_affected', v_count
    )
  );

  RETURN v_event_id;
END;
$$;

-- 4. Undo a reset from its snapshot.
CREATE OR REPLACE FUNCTION public.admin_restore_stats(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_event public.stats_reset_events%ROWTYPE;
  v_restored integer := 0;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'admin_restore_stats: admin role required';
  END IF;

  SELECT * INTO v_event
  FROM public.stats_reset_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_restore_stats: reset event % not found', p_event_id;
  END IF;
  IF v_event.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'admin_restore_stats: reset event % was already restored', p_event_id;
  END IF;

  UPDATE public.player_season_stats s
  SET wins = (snap->>'wins')::integer,
      losses = (snap->>'losses')::integer,
      points = (snap->>'points')::integer,
      current_streak = (snap->>'current_streak')::integer,
      best_streak = (snap->>'best_streak')::integer,
      matches_played = (snap->>'matches_played')::integer,
      forfeits = (snap->>'forfeits')::integer,
      forfeit_wins = (snap->>'forfeit_wins')::integer,
      challenger_wins = (snap->>'challenger_wins')::integer,
      defender_wins = (snap->>'defender_wins')::integer,
      best_rank_achieved = (snap->>'best_rank_achieved')::integer,
      stats_reset_at = (snap->>'stats_reset_at')::timestamptz,
      updated_at = now()
  FROM jsonb_array_elements(v_event.season_snapshot) AS snap
  WHERE s.player_id = (snap->>'player_id')::uuid;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  UPDATE public.player_discipline_stats d
  SET wins = (snap->>'wins')::integer,
      losses = (snap->>'losses')::integer,
      points = (snap->>'points')::integer,
      current_streak = (snap->>'current_streak')::integer,
      best_streak = (snap->>'best_streak')::integer,
      matches_played = (snap->>'matches_played')::integer,
      forfeits = (snap->>'forfeits')::integer,
      forfeit_wins = (snap->>'forfeit_wins')::integer,
      challenger_wins = (snap->>'challenger_wins')::integer,
      defender_wins = (snap->>'defender_wins')::integer,
      challenges_issued = (snap->>'challenges_issued')::integer,
      challenges_received = (snap->>'challenges_received')::integer,
      total_race_length = (snap->>'total_race_length')::integer,
      updated_at = now()
  FROM jsonb_array_elements(v_event.discipline_snapshot) AS snap
  WHERE d.player_id = (snap->>'player_id')::uuid
    AND d.discipline = (snap->>'discipline');

  UPDATE public.stats_reset_events
  SET restored_at = now(), restored_by = auth.uid()
  WHERE id = p_event_id;

  INSERT INTO public.audit_events(actor_profile_id, action, target_type, target_id, detail)
  VALUES (
    auth.uid(),
    'stats.reset_restored',
    v_event.scope,
    v_event.player_id,
    jsonb_build_object('event_id', p_event_id, 'players_restored', v_restored)
  );

  RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_stats(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_restore_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_stats(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_restore_stats(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_reset_stats(uuid, boolean) IS
  'Zero season and discipline stats for one player (p_player_id) or the whole league (NULL). p_keep_history=false also stamps stats_reset_at so the app hides pre-reset matches. Snapshots prior state into stats_reset_events and returns that event id for undo. Admin/super_admin only. Does not touch rankings or delete matches.';

COMMENT ON FUNCTION public.admin_restore_stats(uuid) IS
  'Undo a reset by restoring the snapshot captured in stats_reset_events. Admin/super_admin only. Each event can be restored once.';
