-- Align the database with Carl's written Top of the Falls rules.
--
-- Three things, all traced to the rules document:
--
-- 1. Settings columns the app reads and writes but that never existed here.
--    create-challenge selects challenge_weekly_limit in the same query as
--    min_race, challenge_range, challenge_expiry_days and disciplines — so the
--    whole select failed and the function silently fell back to hardcoded
--    defaults. league_settings has therefore been inert. The admin Settings tab
--    could not save at all, because its payload named three missing columns.
--
-- 2. Cooldowns. Rule 5 is specific and the code implemented roughly the
--    opposite:
--      5a  defend your spot            -> may challenge immediately
--      5b  lower seed wins             -> wait 24 hrs (explicitly incl. forfeits)
--      5c  you lose                    -> defend, or wait 7 days to challenge up
--    Only the loser was cooled down, and only for 24 hours. cooldown_hours now
--    means "won your way up" and loss_cooldown_hours covers 5c.
--    A cooldown blocks challenging, never defending — which is what "must
--    either defend or wait" requires, and is already how create-challenge
--    checks it.
--
-- 3. The rank-1 obligation is gone from the ladder functions. Carl's rules
--    contain no obligation on the #1 player; 20260615120000 disabled the
--    enforcement functions but left every writer of rankings.rank1_since in
--    place, so the clock still started whenever someone took #1. The column is
--    left in place (types and history reference it) but nothing writes it.

-- ─── 1. Settings the rules actually specify ─────────────────────────────────

ALTER TABLE public.league_settings
  ADD COLUMN IF NOT EXISTS challenge_weekly_limit integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS challenge_response_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS match_play_days integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS loss_cooldown_hours integer NOT NULL DEFAULT 168;

COMMENT ON COLUMN public.league_settings.challenge_weekly_limit IS
  'Rule 3b.II — two challenges per week.';
COMMENT ON COLUMN public.league_settings.challenge_response_hours IS
  'Rule 3 — the challenged player must respond within 48 hrs of the callout.';
COMMENT ON COLUMN public.league_settings.match_play_days IS
  'Rule 3a.I — match must be played within 10 days of the challenge being accepted.';
COMMENT ON COLUMN public.league_settings.cooldown_hours IS
  'Rule 5b — a challenger who wins and moves up waits this long before challenging again. Forfeit wins included.';
COMMENT ON COLUMN public.league_settings.loss_cooldown_hours IS
  'Rule 5c — after a loss you may defend, but must wait this long before challenging up.';

-- ─── 2. Ladder movement no longer starts a rank-1 clock ─────────────────────

CREATE OR REPLACE FUNCTION public.cascade_ranking_after_win(p_winner_id uuid, p_loser_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_winner_pos integer;
  v_loser_pos integer;
BEGIN
  LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE;

  SELECT position INTO v_winner_pos
  FROM public.rankings
  WHERE player_id = p_winner_id;

  SELECT position INTO v_loser_pos
  FROM public.rankings
  WHERE player_id = p_loser_id;

  IF v_winner_pos IS NULL OR v_loser_pos IS NULL OR v_winner_pos <= v_loser_pos THEN
    RETURN;
  END IF;

  UPDATE public.rankings
  SET
    previous_position = position,
    position = position + 1000,
    updated_at = now()
  WHERE position BETWEEN v_loser_pos AND v_winner_pos;

  UPDATE public.rankings
  SET
    previous_position = v_winner_pos,
    position = v_loser_pos,
    updated_at = now()
  WHERE player_id = p_winner_id;

  UPDATE public.rankings
  SET
    position = position - 999,
    updated_at = now()
  WHERE position BETWEEN (1000 + v_loser_pos) AND (1000 + v_winner_pos - 1);
END;
$function$;

COMMENT ON FUNCTION public.cascade_ranking_after_win(uuid, uuid) IS
  'Move the winner into the loser''s spot and push everyone between down one. Top of the Falls has no rank-1 obligation, so no rank-1 clock is started.';

-- ─── 3. Forfeit cooldowns follow rule 5 ─────────────────────────────────────
-- Declining is a loss for the challenged player (5c, 7 days) and a win from
-- below for the challenger (5b, 24 hrs — "this includes forfeits"). The
-- challenger's cooldown id rides in metadata so the reversal can undo both
-- without a schema change to challenge_forfeiture_events.

CREATE OR REPLACE FUNCTION public.apply_challenge_decline_forfeit(p_challenge_id uuid, p_actor_profile_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_challenge public.challenges%ROWTYPE;
  v_event_id uuid;
  v_cooldown_id uuid;
  v_challenger_cooldown_id uuid;
  v_activity_event_id uuid;
  v_notification_ids uuid[] := '{}'::uuid[];
  v_challenger_previous_position integer;
  v_forfeiting_previous_position integer;
  v_challenger_new_position integer;
  v_forfeiting_new_position integer;
  v_challenger_name text;
  v_forfeiting_name text;
  v_challenger_rank1_since timestamptz;
  v_forfeiting_rank1_since timestamptz;
  v_win_cooldown_hours integer;
  v_loss_cooldown_hours integer;
  v_challenger_season_before jsonb := '{}'::jsonb;
  v_forfeiting_season_before jsonb := '{}'::jsonb;
  v_challenger_discipline_before jsonb := '{}'::jsonb;
  v_forfeiting_discipline_before jsonb := '{}'::jsonb;
BEGIN
  LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO v_challenge FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Challenge % not found', p_challenge_id; END IF;
  IF v_challenge.status <> 'pending' THEN
    RAISE EXCEPTION 'Challenge % is %, not pending', p_challenge_id, v_challenge.status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.challenge_forfeiture_events WHERE challenge_id = p_challenge_id AND reversed_at IS NULL) THEN
    RAISE EXCEPTION 'Challenge % already has an active forfeit event', p_challenge_id;
  END IF;

  SELECT position, rank1_since INTO v_challenger_previous_position, v_challenger_rank1_since
  FROM public.rankings WHERE player_id = v_challenge.challenger_id;
  SELECT position, rank1_since INTO v_forfeiting_previous_position, v_forfeiting_rank1_since
  FROM public.rankings WHERE player_id = v_challenge.challenged_id;
  SELECT full_name INTO v_challenger_name FROM public.players WHERE id = v_challenge.challenger_id;
  SELECT full_name INTO v_forfeiting_name FROM public.players WHERE id = v_challenge.challenged_id;

  INSERT INTO public.player_season_stats(player_id)
  VALUES (v_challenge.challenger_id), (v_challenge.challenged_id)
  ON CONFLICT (player_id) DO NOTHING;

  INSERT INTO public.player_discipline_stats(player_id, discipline)
  VALUES (v_challenge.challenger_id, v_challenge.discipline), (v_challenge.challenged_id, v_challenge.discipline)
  ON CONFLICT (player_id, discipline) DO NOTHING;

  SELECT to_jsonb(stats) INTO v_challenger_season_before
  FROM public.player_season_stats stats WHERE stats.player_id = v_challenge.challenger_id;
  SELECT to_jsonb(stats) INTO v_forfeiting_season_before
  FROM public.player_season_stats stats WHERE stats.player_id = v_challenge.challenged_id;
  SELECT to_jsonb(stats) INTO v_challenger_discipline_before
  FROM public.player_discipline_stats stats
  WHERE stats.player_id = v_challenge.challenger_id AND stats.discipline = v_challenge.discipline;
  SELECT to_jsonb(stats) INTO v_forfeiting_discipline_before
  FROM public.player_discipline_stats stats
  WHERE stats.player_id = v_challenge.challenged_id AND stats.discipline = v_challenge.discipline;

  UPDATE public.challenges
  SET status = 'forfeited',
      response_message = COALESCE(response_message, 'Declined challenge counted as a forfeit.'),
      updated_at = now()
  WHERE id = p_challenge_id;

  IF v_challenger_previous_position IS NOT NULL AND v_forfeiting_previous_position IS NOT NULL
     AND v_challenger_previous_position > v_forfeiting_previous_position THEN
    PERFORM public.cascade_ranking_after_win(v_challenge.challenger_id, v_challenge.challenged_id);
  END IF;

  SELECT position INTO v_challenger_new_position FROM public.rankings WHERE player_id = v_challenge.challenger_id;
  SELECT position INTO v_forfeiting_new_position FROM public.rankings WHERE player_id = v_challenge.challenged_id;

  UPDATE public.player_season_stats
  SET wins = wins + 1, forfeit_wins = forfeit_wins + 1, challenger_wins = challenger_wins + 1,
      current_streak = CASE WHEN current_streak >= 0 THEN current_streak + 1 ELSE 1 END,
      best_streak = GREATEST(best_streak, CASE WHEN current_streak >= 0 THEN current_streak + 1 ELSE 1 END),
      best_rank_achieved = CASE
        WHEN v_challenger_new_position IS NULL THEN best_rank_achieved
        WHEN best_rank_achieved IS NULL OR v_challenger_new_position < best_rank_achieved THEN v_challenger_new_position
        ELSE best_rank_achieved END,
      updated_at = now()
  WHERE player_id = v_challenge.challenger_id;

  UPDATE public.player_season_stats
  SET forfeits = forfeits + 1, current_streak = 0, updated_at = now()
  WHERE player_id = v_challenge.challenged_id;

  UPDATE public.player_discipline_stats
  SET wins = wins + 1, forfeit_wins = forfeit_wins + 1, challenger_wins = challenger_wins + 1,
      current_streak = CASE WHEN current_streak >= 0 THEN current_streak + 1 ELSE 1 END,
      best_streak = GREATEST(best_streak, CASE WHEN current_streak >= 0 THEN current_streak + 1 ELSE 1 END),
      updated_at = now()
  WHERE player_id = v_challenge.challenger_id AND discipline = v_challenge.discipline;

  UPDATE public.player_discipline_stats
  SET forfeits = forfeits + 1, current_streak = 0, updated_at = now()
  WHERE player_id = v_challenge.challenged_id AND discipline = v_challenge.discipline;

  SELECT cooldown_hours, loss_cooldown_hours
  INTO v_win_cooldown_hours, v_loss_cooldown_hours
  FROM public.league_settings LIMIT 1;
  v_win_cooldown_hours := COALESCE(v_win_cooldown_hours, 24);
  v_loss_cooldown_hours := COALESCE(v_loss_cooldown_hours, 168);

  -- Rule 5c: the player who declined took the loss.
  IF v_loss_cooldown_hours > 0 THEN
    INSERT INTO public.cooldowns(player_id, type, expires_at)
    VALUES (v_challenge.challenged_id, 'post_match', now() + make_interval(hours => v_loss_cooldown_hours))
    RETURNING id INTO v_cooldown_id;
  END IF;

  -- Rule 5b: the challenger won from below, forfeits included.
  IF v_win_cooldown_hours > 0 AND v_challenger_new_position IS DISTINCT FROM v_challenger_previous_position THEN
    INSERT INTO public.cooldowns(player_id, type, expires_at)
    VALUES (v_challenge.challenger_id, 'post_match', now() + make_interval(hours => v_win_cooldown_hours))
    RETURNING id INTO v_challenger_cooldown_id;
  END IF;

  INSERT INTO public.activity_feed(event_type, headline, detail, actor_player_id)
  VALUES (
    'challenge_forfeited',
    COALESCE(v_challenger_name, 'Challenger') || ' won by forfeit after ' ||
      COALESCE(v_forfeiting_name, 'the challenged player') || ' declined the challenge.',
    'Discipline: ' || v_challenge.discipline || '. Race to ' || v_challenge.race_length ||
      '. Ranking moved from #' || COALESCE(v_challenger_previous_position::text, '?') ||
      ' vs #' || COALESCE(v_forfeiting_previous_position::text, '?') ||
      ' to #' || COALESCE(v_challenger_new_position::text, '?') ||
      ' vs #' || COALESCE(v_forfeiting_new_position::text, '?') ||
      '. No match fee was charged.',
    v_challenge.challenged_id
  )
  RETURNING id INTO v_activity_event_id;

  WITH inserted_notifications AS (
    INSERT INTO public.notifications(player_id, type, title, body, reference_id, reference_type)
    VALUES
      (v_challenge.challenger_id, 'challenge_forfeit_win', 'Challenge won by forfeit',
        COALESCE(v_forfeiting_name, 'Your opponent') || ' declined your ' || v_challenge.discipline ||
        ' challenge. Your record and ranking have been updated.', p_challenge_id, 'challenge'),
      (v_challenge.challenged_id, 'challenge_forfeited', 'Challenge declined as forfeit',
        'Declining ' || COALESCE(v_challenger_name, 'the challenger') || '''s ' || v_challenge.discipline ||
        ' challenge was recorded as a forfeit. No match fee was charged.', p_challenge_id, 'challenge')
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_notification_ids FROM inserted_notifications;

  INSERT INTO public.audit_events(actor_profile_id, action, target_type, target_id, detail)
  VALUES (p_actor_profile_id, 'challenge_decline_forfeit_applied', 'challenge', p_challenge_id,
    jsonb_build_object(
      'challenger_id', v_challenge.challenger_id,
      'forfeiting_player_id', v_challenge.challenged_id,
      'challenger_previous_position', v_challenger_previous_position,
      'forfeiting_previous_position', v_forfeiting_previous_position,
      'challenger_new_position', v_challenger_new_position,
      'forfeiting_new_position', v_forfeiting_new_position,
      'cooldown_id', v_cooldown_id,
      'challenger_cooldown_id', v_challenger_cooldown_id,
      'activity_event_id', v_activity_event_id,
      'notification_ids', v_notification_ids
    ));

  INSERT INTO public.challenge_forfeiture_events(
    challenge_id, challenger_id, forfeiting_player_id, winner_id, loser_id,
    previous_challenge_status, challenger_previous_position, forfeiting_previous_position,
    challenger_new_position, forfeiting_new_position, cooldown_id, activity_event_id,
    notification_ids, metadata
  )
  VALUES (
    p_challenge_id, v_challenge.challenger_id, v_challenge.challenged_id,
    v_challenge.challenger_id, v_challenge.challenged_id, v_challenge.status,
    v_challenger_previous_position, v_forfeiting_previous_position,
    v_challenger_new_position, v_forfeiting_new_position,
    v_cooldown_id, v_activity_event_id, v_notification_ids,
    jsonb_build_object(
      'actor_profile_id', p_actor_profile_id,
      'discipline', v_challenge.discipline,
      'race_length', v_challenge.race_length,
      'previous_response_message', v_challenge.response_message,
      'challenger_cooldown_id', v_challenger_cooldown_id,
      'challenger_rank1_since_before', v_challenger_rank1_since,
      'forfeiting_rank1_since_before', v_forfeiting_rank1_since,
      'challenger_season_before', v_challenger_season_before,
      'forfeiting_season_before', v_forfeiting_season_before,
      'challenger_discipline_before', v_challenger_discipline_before,
      'forfeiting_discipline_before', v_forfeiting_discipline_before
    ))
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$function$;

-- Reversal must clear both cooldowns, or an undone decline still leaves the
-- challenger sitting out 24 hours for a forfeit that no longer exists.
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
    UPDATE public.rankings SET previous_position = position, position = position + 1000, updated_at = now()
    WHERE position BETWEEN v_event.challenger_new_position AND v_event.challenger_previous_position;

    UPDATE public.rankings
    SET previous_position = v_event.challenger_new_position, position = v_event.challenger_previous_position,
        updated_at = now()
    WHERE player_id = v_event.challenger_id;

    UPDATE public.rankings SET position = position - 1001, updated_at = now()
    WHERE position BETWEEN (1000 + v_event.challenger_new_position + 1) AND (1000 + v_event.challenger_previous_position);
  END IF;

  UPDATE public.challenges
  SET status = v_event.previous_challenge_status,
      response_message = v_event.metadata->>'previous_response_message', updated_at = now()
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

-- ─── 4. Admin reorder no longer starts a rank-1 clock ───────────────────────

CREATE OR REPLACE FUNCTION public.admin_reorder_rankings(p_order jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_rows integer;
  v_expected integer;
  v_distinct_players integer;
  v_distinct_positions integer;
  v_before jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'admin_reorder_rankings: admin role required';
  END IF;

  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'array' OR jsonb_array_length(p_order) = 0 THEN
    RAISE EXCEPTION 'admin_reorder_rankings: p_order must be a non-empty array';
  END IF;

  v_expected := jsonb_array_length(p_order);

  SELECT count(DISTINCT x.player_id), count(DISTINCT x.position)
  INTO v_distinct_players, v_distinct_positions
  FROM jsonb_to_recordset(p_order) AS x(player_id uuid, position integer);

  IF v_distinct_players <> v_expected OR v_distinct_positions <> v_expected THEN
    RAISE EXCEPTION 'admin_reorder_rankings: duplicate player or position in payload';
  END IF;

  LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE;

  IF v_expected <> (SELECT count(*) FROM public.rankings) THEN
    RAISE EXCEPTION 'admin_reorder_rankings: payload must cover the entire ladder';
  END IF;
  IF (SELECT array_agg(x.position ORDER BY x.position)
      FROM jsonb_to_recordset(p_order) AS x(position integer))
     <> (SELECT array_agg(g) FROM generate_series(1, v_expected) g) THEN
    RAISE EXCEPTION 'admin_reorder_rankings: positions must be a contiguous 1..N sequence';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('player_id', player_id, 'position', position) ORDER BY position)
  INTO v_before
  FROM public.rankings;

  UPDATE public.rankings r
  SET
    position = x.position + 1000,
    previous_position = r.position,
    updated_at = now()
  FROM jsonb_to_recordset(p_order) AS x(player_id uuid, position integer)
  WHERE r.player_id = x.player_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> v_expected THEN
    RAISE EXCEPTION 'admin_reorder_rankings: % rankings rows matched, expected %', v_rows, v_expected;
  END IF;

  UPDATE public.rankings
  SET
    position = position - 1000,
    updated_at = now()
  WHERE position > 1000;

  INSERT INTO public.audit_events (actor_profile_id, action, target_type, target_id, detail)
  VALUES (
    auth.uid(),
    'rankings.admin_reorder',
    'rankings',
    NULL,
    jsonb_build_object('before', v_before, 'after', p_order)
  );
END;
$$;

-- Any clock a previous version started is meaningless now.
UPDATE public.rankings SET rank1_since = NULL WHERE rank1_since IS NOT NULL;

INSERT INTO public.audit_events (action, target_type, detail)
VALUES (
  'tof_rules_alignment_applied',
  'league_settings',
  jsonb_build_object(
    'league', 'Top of the Falls',
    'source', 'Carl Higgins rules document',
    'changes', array[
      'Added challenge_weekly_limit, challenge_response_hours, match_play_days, loss_cooldown_hours',
      'Rule 5b: a challenger who wins and moves up now waits cooldown_hours (forfeits included)',
      'Rule 5c: a loss now costs loss_cooldown_hours before challenging up; defending is unaffected',
      'Removed every rank-1 obligation writer — the rules contain no such rule'
    ]
  )
);
