-- Stop a reversed forfeit from being re-forfeited an hour later.
--
-- Carl: a player won and "it moved them up two spots and instead of just one".
-- The swap itself was never wrong. cascade_ranking_after_win is a clean
-- exchange, and it was doing exactly that. The extra movement came from a
-- second event nobody asked for.
--
-- expire_stale_challenges() forfeits every challenge that is pending with
-- expires_at in the past, and a forfeit awards the challenger a swap up the
-- ladder. When an admin judged one of those wrong and hit Reverse Decline, the
-- reversal put the status back to 'pending' but left expires_at where it was --
-- already past, since expiring is how the challenge got forfeited to begin
-- with. That is the sweep's exact predicate, so the next hourly run forfeited
-- it again. Apply, reverse, apply: the ladder moved on every pass, and a player
-- who won a match legitimately (one spot) could also collect a spot from a
-- stale challenge of their own being force-forfeited underneath them.
--
-- Verified on the live project before writing this: 39
-- challenge_decline_forfeit_applied and 24 challenge_decline_forfeit_reversed
-- inside three days; Ron DeWitt/Wade Thompson, Dean Mueller/Kelly Gilligan and
-- Bryan Vaden/Carp Mazing each forfeited three separate times; all 16 affected
-- challenges past expiry, the earliest since 2026-09-05; and five manual
-- rankings.admin_reorder passes by the admin cleaning up after it.
--
-- The function below is the deployed 20260814121000 definition with one
-- statement changed -- the challenge restore now refreshes a lapsed window.

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
    IF v_event.challenger_new_position = v_event.forfeiting_previous_position
       AND v_event.forfeiting_new_position = v_event.challenger_previous_position THEN
      PERFORM public.cascade_ranking_after_win(
        v_event.forfeiting_player_id,
        v_event.challenger_id
      );
    ELSE
      UPDATE public.rankings SET previous_position = position, position = position + 1000, updated_at = now()
      WHERE position BETWEEN v_event.challenger_new_position AND v_event.challenger_previous_position;

      UPDATE public.rankings
      SET previous_position = v_event.challenger_new_position, position = v_event.challenger_previous_position,
          updated_at = now()
      WHERE player_id = v_event.challenger_id;

      UPDATE public.rankings SET position = position - 1001, updated_at = now()
      WHERE position BETWEEN (1000 + v_event.challenger_new_position + 1) AND (1000 + v_event.challenger_previous_position);
    END IF;
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
