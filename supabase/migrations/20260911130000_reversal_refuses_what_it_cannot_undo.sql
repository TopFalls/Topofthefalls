-- Reversing a forfeit refuses what it can no longer undo.
--
-- Found by the migration review of 20260911120000, then confirmed against live
-- data. The rotation that migration introduces is correct, but it changes the
-- shape of the forfeit events this function has to invert, and the function
-- could not tell the old shape from the new one.
--
-- Under the old swap, a forfeit recorded forfeiting_new_position = the
-- challenger's old spot, whatever the gap. Under the rotation it records
-- forfeiting_previous_position + 1, always. The fast path here keyed on the
-- swap pattern -- which a rotation over a gap of one also satisfies -- so a
-- swap-era event with a gap of two would have taken it and been undone as if it
-- were a rotation: the challenger dropped one spot instead of returning to
-- theirs, and an untouched player in between was pulled down a spot they never
-- lost.
--
-- Live check before writing this, over unreversed events with a gap above one:
-- seven exist; six are already refused by the ranking check because Mike's
-- manual reorders moved the positions out from under them; one -- created
-- 2026-09-11 02:07, gap two -- still sits exactly on its recorded positions and
-- would have gone through.
--
-- Two changes: refuse any event whose recorded move is not a one-spot drop, and
-- drop the fast path so the block shift (a correct inverse of the rotation at
-- every gap) is the only route. Neither is a behaviour change for events the
-- rotation records; both close the door on the ones it does not.

CREATE OR REPLACE FUNCTION public.reverse_challenge_decline_forfeit(p_challenge_id uuid, p_actor_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_challenge public.challenges%ROWTYPE;
  v_event public.challenge_forfeiture_events%ROWTYPE;
  v_challenger_current_position integer;
  v_forfeiting_current_position integer;
  v_challenger_name text;
  v_forfeiting_name text;
  v_reversal_activity_event_id uuid;
  v_reversal_notification_ids uuid[] := '{}'::uuid[];
  v_challenger_cooldown_id uuid;
  v_challenger_season_before jsonb;
  v_forfeiting_season_before jsonb;
  v_challenger_discipline_before jsonb;
  v_forfeiting_discipline_before jsonb;
  v_expected_challenger_season_streak integer;
  v_expected_challenger_discipline_streak integer;
  v_expected_challenger_best_rank integer;
BEGIN
  IF p_actor_profile_id IS NULL THEN
    RAISE EXCEPTION 'Actor profile id is required to reverse a forfeit';
  END IF;

  LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO v_event FROM public.challenge_forfeiture_events
  WHERE challenge_id = p_challenge_id AND reversed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge % has no active forfeit event to reverse', p_challenge_id;
  END IF;

  SELECT * INTO v_challenge FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge % not found while reversing forfeit', p_challenge_id;
  END IF;

  IF v_challenge.status <> 'forfeited'
     OR v_challenge.challenger_id <> v_event.challenger_id
     OR v_challenge.challenged_id <> v_event.forfeiting_player_id
     OR v_challenge.response_message IS DISTINCT FROM COALESCE(
       v_event.metadata->>'previous_response_message',
       'Declined challenge counted as a forfeit.'
     ) THEN
    RAISE EXCEPTION 'Cannot automatically reverse challenge %, challenge row changed after the forfeit', p_challenge_id;
  END IF;

  SELECT position INTO v_challenger_current_position FROM public.rankings WHERE player_id = v_event.challenger_id;
  SELECT position INTO v_forfeiting_current_position FROM public.rankings WHERE player_id = v_event.forfeiting_player_id;

  IF v_challenger_current_position IS DISTINCT FROM v_event.challenger_new_position
     OR v_forfeiting_current_position IS DISTINCT FROM v_event.forfeiting_new_position THEN
    RAISE EXCEPTION 'Cannot automatically reverse challenge %, rankings changed after the forfeit', p_challenge_id;
  END IF;

  -- Refuse an event recorded under the old swap, because nothing here inverts
  -- it any more.
  --
  -- cascade_ranking_after_win rotates as of 20260911120000: the winner takes
  -- the spot they challenged and everyone they passed drops exactly one, so a
  -- forfeit it records always leaves the forfeiting player exactly one below
  -- where they started. The swap it replaced left them where the challenger had
  -- been, which for a gap of more than one is a different shape entirely.
  --
  -- The block shift below is the exact inverse of a rotation at any gap. It is
  -- not the inverse of a swap over a gap greater than one, and neither is
  -- anything else left in this function. Most stale events are already stopped
  -- by the ranking check above once positions drift, but one still sitting on
  -- its recorded positions would sail through and be silently mangled. Refuse
  -- and let an admin put it right by hand instead of guessing.
  -- The first three conditions are the same gate the restore block below uses,
  -- so the guard refuses exactly the events that block would have touched and
  -- nothing else. That matters: a forfeit where the challenger was already
  -- ahead of the forfeiting player moves nobody, records the two players on
  -- their own spots, and is perfectly reversible. Three such events are live.
  -- Without "the challenger actually moved" they would all be refused, because
  -- a player who did not move is not one spot below where they were.
  IF v_event.challenger_previous_position IS NOT NULL
     AND v_event.challenger_new_position IS NOT NULL
     AND v_event.forfeiting_previous_position IS NOT NULL
     AND v_event.challenger_previous_position IS DISTINCT FROM v_event.challenger_new_position
     AND v_event.forfeiting_new_position IS DISTINCT FROM v_event.forfeiting_previous_position + 1 THEN
    RAISE EXCEPTION 'Cannot automatically reverse challenge %, it was recorded before the ladder rule changed on 2026-09-11 and moved the loser more than one spot. Put the positions right on the Rankings tab instead.', p_challenge_id;
  END IF;

  v_challenger_season_before := v_event.metadata->'challenger_season_before';
  v_forfeiting_season_before := v_event.metadata->'forfeiting_season_before';
  v_challenger_discipline_before := v_event.metadata->'challenger_discipline_before';
  v_forfeiting_discipline_before := v_event.metadata->'forfeiting_discipline_before';

  IF v_challenger_season_before IS NULL OR v_forfeiting_season_before IS NULL
     OR v_challenger_discipline_before IS NULL OR v_forfeiting_discipline_before IS NULL THEN
    RAISE EXCEPTION 'Cannot automatically reverse challenge %, forfeit stat snapshots are missing', p_challenge_id;
  END IF;

  v_expected_challenger_season_streak := CASE
    WHEN (v_challenger_season_before->>'current_streak')::integer >= 0
    THEN (v_challenger_season_before->>'current_streak')::integer + 1 ELSE 1 END;
  v_expected_challenger_discipline_streak := CASE
    WHEN (v_challenger_discipline_before->>'current_streak')::integer >= 0
    THEN (v_challenger_discipline_before->>'current_streak')::integer + 1 ELSE 1 END;
  v_expected_challenger_best_rank := CASE
    WHEN v_event.challenger_new_position IS NULL THEN (v_challenger_season_before->>'best_rank_achieved')::integer
    WHEN (v_challenger_season_before->>'best_rank_achieved')::integer IS NULL THEN v_event.challenger_new_position
    WHEN v_event.challenger_new_position < (v_challenger_season_before->>'best_rank_achieved')::integer THEN v_event.challenger_new_position
    ELSE (v_challenger_season_before->>'best_rank_achieved')::integer END;

  IF NOT EXISTS (
    SELECT 1 FROM public.player_season_stats WHERE player_id = v_event.challenger_id
      AND wins IS NOT DISTINCT FROM (v_challenger_season_before->>'wins')::integer + 1
      AND forfeit_wins IS NOT DISTINCT FROM (v_challenger_season_before->>'forfeit_wins')::integer + 1
      AND challenger_wins IS NOT DISTINCT FROM (v_challenger_season_before->>'challenger_wins')::integer + 1
      AND current_streak IS NOT DISTINCT FROM v_expected_challenger_season_streak
      AND best_streak IS NOT DISTINCT FROM GREATEST((v_challenger_season_before->>'best_streak')::integer, v_expected_challenger_season_streak)
      AND best_rank_achieved IS NOT DISTINCT FROM v_expected_challenger_best_rank
  ) THEN RAISE EXCEPTION 'Cannot automatically reverse challenge %, challenger season stats changed after the forfeit', p_challenge_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.player_season_stats WHERE player_id = v_event.forfeiting_player_id
      AND forfeits IS NOT DISTINCT FROM (v_forfeiting_season_before->>'forfeits')::integer + 1
      AND current_streak IS NOT DISTINCT FROM 0
  ) THEN RAISE EXCEPTION 'Cannot automatically reverse challenge %, forfeiting player season stats changed after the forfeit', p_challenge_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.player_discipline_stats WHERE player_id = v_event.challenger_id
      AND discipline = v_event.metadata->>'discipline'
      AND wins IS NOT DISTINCT FROM (v_challenger_discipline_before->>'wins')::integer + 1
      AND forfeit_wins IS NOT DISTINCT FROM (v_challenger_discipline_before->>'forfeit_wins')::integer + 1
      AND challenger_wins IS NOT DISTINCT FROM (v_challenger_discipline_before->>'challenger_wins')::integer + 1
      AND current_streak IS NOT DISTINCT FROM v_expected_challenger_discipline_streak
      AND best_streak IS NOT DISTINCT FROM GREATEST((v_challenger_discipline_before->>'best_streak')::integer, v_expected_challenger_discipline_streak)
  ) THEN RAISE EXCEPTION 'Cannot automatically reverse challenge %, challenger discipline stats changed after the forfeit', p_challenge_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.player_discipline_stats WHERE player_id = v_event.forfeiting_player_id
      AND discipline = v_event.metadata->>'discipline'
      AND forfeits IS NOT DISTINCT FROM (v_forfeiting_discipline_before->>'forfeits')::integer + 1
      AND current_streak IS NOT DISTINCT FROM 0
  ) THEN RAISE EXCEPTION 'Cannot automatically reverse challenge %, forfeiting player discipline stats changed after the forfeit', p_challenge_id;
  END IF;

  IF v_event.challenger_previous_position IS NOT NULL AND v_event.challenger_new_position IS NOT NULL
     AND v_event.challenger_previous_position <> v_event.challenger_new_position THEN
    -- One path, not two. The old fast path fired when the recorded move looked
    -- like a clean exchange and called cascade_ranking_after_win to undo it --
    -- but that function rotates now, and a swap-era event with a gap of more
    -- than one looks identical to a rotation-era event with a gap of one. The
    -- block shift below inverts a rotation at every gap, including one, so the
    -- shortcut bought nothing and could not tell the two apart.
    UPDATE public.rankings SET previous_position = position, position = position + 1000, updated_at = now()
    WHERE position BETWEEN v_event.challenger_new_position AND v_event.challenger_previous_position;

    UPDATE public.rankings
    SET previous_position = v_event.challenger_new_position, position = v_event.challenger_previous_position,
        updated_at = now()
    WHERE player_id = v_event.challenger_id;

    UPDATE public.rankings SET position = position - 1001, updated_at = now()
    WHERE position BETWEEN (1000 + v_event.challenger_new_position + 1) AND (1000 + v_event.challenger_previous_position);
  END IF;

  -- Give the challenge a real response window back.
  --
  -- This is the line the ladder loop turned on. The reversal restored
  -- status='pending' and left expires_at alone -- days in the past, because a
  -- challenge only reaches a forfeit by expiring in the first place. That is
  -- exactly what expire_stale_challenges() sweeps: pending AND expires_at <=
  -- now(). So the next hourly run forfeited it again, an admin reversed it
  -- again, and every pass moved the ladder. 39 forfeits and 24 reversals in
  -- three days, the same pairings two and three times each, and the positions
  -- hand-fixed five times.
  --
  -- An admin reversing a forfeit means "this challenge still stands", so it
  -- needs time to actually be answered. Only a window already in the past is
  -- refreshed; a reversal that arrives while the challenge is still live leaves
  -- the original deadline alone.
  UPDATE public.challenges
  SET status = v_event.previous_challenge_status,
      response_message = v_event.metadata->>'previous_response_message',
      expires_at = CASE
        WHEN expires_at <= now() THEN now() + make_interval(hours => COALESCE(
          (SELECT ls.challenge_response_hours FROM public.league_settings ls LIMIT 1), 48))
        ELSE expires_at
      END,
      updated_at = now()
  WHERE id = p_challenge_id;

  IF v_event.cooldown_id IS NOT NULL THEN
    DELETE FROM public.cooldowns WHERE id = v_event.cooldown_id;
  END IF;

  v_challenger_cooldown_id := NULLIF(v_event.metadata->>'challenger_cooldown_id', '')::uuid;
  IF v_challenger_cooldown_id IS NOT NULL THEN
    DELETE FROM public.cooldowns WHERE id = v_challenger_cooldown_id;
  END IF;

  UPDATE public.player_season_stats
  SET wins = (v_challenger_season_before->>'wins')::integer,
      forfeit_wins = (v_challenger_season_before->>'forfeit_wins')::integer,
      challenger_wins = (v_challenger_season_before->>'challenger_wins')::integer,
      current_streak = (v_challenger_season_before->>'current_streak')::integer,
      best_streak = (v_challenger_season_before->>'best_streak')::integer,
      best_rank_achieved = (v_challenger_season_before->>'best_rank_achieved')::integer,
      updated_at = now()
  WHERE player_id = v_event.challenger_id;

  UPDATE public.player_season_stats
  SET forfeits = (v_forfeiting_season_before->>'forfeits')::integer,
      current_streak = (v_forfeiting_season_before->>'current_streak')::integer, updated_at = now()
  WHERE player_id = v_event.forfeiting_player_id;

  UPDATE public.player_discipline_stats
  SET wins = (v_challenger_discipline_before->>'wins')::integer,
      forfeit_wins = (v_challenger_discipline_before->>'forfeit_wins')::integer,
      challenger_wins = (v_challenger_discipline_before->>'challenger_wins')::integer,
      current_streak = (v_challenger_discipline_before->>'current_streak')::integer,
      best_streak = (v_challenger_discipline_before->>'best_streak')::integer, updated_at = now()
  WHERE player_id = v_event.challenger_id AND discipline = v_event.metadata->>'discipline';

  UPDATE public.player_discipline_stats
  SET forfeits = (v_forfeiting_discipline_before->>'forfeits')::integer,
      current_streak = (v_forfeiting_discipline_before->>'current_streak')::integer, updated_at = now()
  WHERE player_id = v_event.forfeiting_player_id AND discipline = v_event.metadata->>'discipline';

  SELECT full_name INTO v_challenger_name FROM public.players WHERE id = v_event.challenger_id;
  SELECT full_name INTO v_forfeiting_name FROM public.players WHERE id = v_event.forfeiting_player_id;

  INSERT INTO public.activity_feed(event_type, headline, detail, actor_player_id)
  VALUES ('challenge_forfeit_reversed',
    'Accidental decline reversed for ' || COALESCE(v_challenger_name, 'the challenger') ||
      ' vs ' || COALESCE(v_forfeiting_name, 'the challenged player') || '.',
    'The challenge is pending again. Forfeit stats, cooldowns, and immediate ranking movement were reversed by an admin.',
    v_event.forfeiting_player_id)
  RETURNING id INTO v_reversal_activity_event_id;

  WITH inserted_notifications AS (
    INSERT INTO public.notifications(player_id, type, title, body, reference_id, reference_type)
    VALUES
      (v_event.challenger_id, 'challenge_forfeit_reversed', 'Decline reversed',
        'An admin reversed the accidental decline. Your challenge against ' ||
        COALESCE(v_forfeiting_name, 'the challenged player') || ' is pending again.',
        p_challenge_id, 'challenge'),
      (v_event.forfeiting_player_id, 'challenge_forfeit_reversed', 'Decline reversed',
        'An admin reversed the accidental decline. ' ||
        COALESCE(v_challenger_name, 'The challenger') || '''s challenge is pending again.',
        p_challenge_id, 'challenge')
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_reversal_notification_ids FROM inserted_notifications;

  UPDATE public.challenge_forfeiture_events
  SET reversed_at = now(), reversed_by_profile_id = p_actor_profile_id,
      metadata = metadata || jsonb_build_object(
        'reversal_activity_event_id', v_reversal_activity_event_id,
        'reversal_notification_ids', v_reversal_notification_ids)
  WHERE id = v_event.id;

  INSERT INTO public.audit_events(actor_profile_id, action, target_type, target_id, detail)
  VALUES (p_actor_profile_id, 'challenge_decline_forfeit_reversed', 'challenge', p_challenge_id,
    jsonb_build_object(
      'forfeiture_event_id', v_event.id,
      'challenger_id', v_event.challenger_id,
      'forfeiting_player_id', v_event.forfeiting_player_id,
      'reversal_activity_event_id', v_reversal_activity_event_id,
      'reversal_notification_ids', v_reversal_notification_ids
    ));
END;
$function$;
