-- A switch for the testing period: should the app move the list by itself?
--
-- For the next couple of weeks the league admins are in full manual control of
-- the list. The strict, automatic behaviour is expected to come back, so this
-- ships as a switch rather than as a deletion:
--
--   league_settings.automatic_list_changes
--     false (ships this way)  Nothing moves the list on its own.
--       a. An unanswered challenge is NOT forfeited when its response time ends.
--          It stays open and raises one admin alert.
--       b. An inactive player is NOT dropped. The admin gets an alert saying a
--          drop is due, and decides.
--       c. Declining a challenge is a plain decline (handled by the
--          respond-to-challenge edge function, which reads this same switch):
--          no forfeit, no ranking, record or cooldown change. The admin is told.
--     true                    The original behaviour, exactly as before.
--
-- To go back to automatic enforcement, no deploy is needed:
--   UPDATE public.league_settings SET automatic_list_changes = true;
-- and to pause again:
--   UPDATE public.league_settings SET automatic_list_changes = false;
--
-- The existing hourly ('tof-expire-challenges') and daily ('tof-inactive-drift')
-- jobs are left exactly as they are; the functions they call now look at the
-- switch. The 7-day wait after a lost match is untouched in both modes: it only
-- blocks issuing a challenge and moves nobody.
--
-- Forfeits already recorded stay reversible in both modes.

ALTER TABLE public.league_settings
  ADD COLUMN IF NOT EXISTS automatic_list_changes boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.league_settings.automatic_list_changes IS
  'false (testing period): nothing moves the list by itself; overdue challenges, declines and inactivity only alert the admin. true: unanswered challenges and declines forfeit and inactive players drop, as before. Flip with UPDATE public.league_settings SET automatic_list_changes = true|false; no deploy needed.';

-- ─── Overdue challenges ──────────────────────────────────────────────────────
-- ON: the original sweep, each overdue pending challenge goes through the
-- reversible decline-forfeit workflow. OFF: one admin alert per overdue
-- challenge and nothing else.

CREATE OR REPLACE FUNCTION public.expire_stale_challenges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_automatic boolean;
  v_challenge record;
  v_affected_count integer := 0;
BEGIN
  SELECT COALESCE(automatic_list_changes, false) INTO v_automatic
  FROM public.league_settings LIMIT 1;

  IF v_automatic THEN
    FOR v_challenge IN
      SELECT c.id
      FROM public.challenges c
      WHERE c.status = 'pending'
        AND c.expires_at <= now()
      ORDER BY c.expires_at, c.id
      FOR UPDATE SKIP LOCKED
    LOOP
      PERFORM public.apply_challenge_decline_forfeit(v_challenge.id, NULL);
      v_affected_count := v_affected_count + 1;
    END LOOP;

    RETURN v_affected_count;
  END IF;

  INSERT INTO public.admin_alerts
    (alert_type, headline, detail, challenge_id, deadline_at)
  SELECT
    'challenge_overdue',
    p2.full_name || ' has not answered ' || p1.full_name || '''s ' || c.discipline || ' challenge',
    'The response time ended '
      || to_char(c.expires_at AT TIME ZONE 'America/Denver', 'Mon DD FMHH12:MI AM')
      || ' (Mountain). Nothing on the list has changed and the challenge is still open. '
      || 'Update the list if necessary.',
    c.id,
    c.expires_at
  FROM public.challenges c
  JOIN public.players p1 ON p1.id = c.challenger_id
  JOIN public.players p2 ON p2.id = c.challenged_id
  WHERE c.status = 'pending'
    AND c.expires_at <= now()
    -- One alert per challenge and deadline, however often this runs.
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_alerts a
      WHERE a.challenge_id = c.id
        AND a.alert_type = 'challenge_overdue'
        AND a.deadline_at = c.expires_at
    );

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;
  RETURN v_affected_count;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_challenges() IS
  'Switch-aware (league_settings.automatic_list_changes). ON: forfeits each overdue pending challenge through the reversible decline-forfeit workflow. OFF: raises one admin alert per overdue challenge and changes nothing. Returns the number handled. Safe to call repeatedly.';

-- ─── Inactive players ───────────────────────────────────────────────────────
-- ON: the original drift (two spots per completed 30 days). OFF: tell the admin
-- that a drop is due and move nobody. The 90-day review alert is raised in both.

CREATE OR REPLACE FUNCTION public.apply_inactive_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_automatic boolean;
  v_row record;
  v_days numeric;
  v_periods integer;
  v_due integer;
  v_from integer;
  v_to integer;
  v_dropped jsonb := '[]'::jsonb;
  v_due_list jsonb := '[]'::jsonb;
  v_flagged jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(automatic_list_changes, false) INTO v_automatic
  FROM public.league_settings LIMIT 1;

  FOR v_row IN
    SELECT p.id, p.full_name, p.inactive_since, p.inactive_drift_periods
    FROM public.players p
    JOIN public.rankings r ON r.player_id = p.id
    WHERE p.is_active = false AND p.inactive_since IS NOT NULL
    ORDER BY r.position
  LOOP
    v_days := EXTRACT(EPOCH FROM (now() - v_row.inactive_since)) / 86400.0;
    v_periods := floor(v_days / 30.0);
    -- inactive_drift_periods counts 30-day periods already handled or reported.
    v_due := v_periods - COALESCE(v_row.inactive_drift_periods, 0);

    IF v_due > 0 THEN
      -- Re-read: earlier moves in this loop shift the ladder underneath us.
      SELECT position INTO v_from FROM public.rankings WHERE player_id = v_row.id;

      IF v_automatic THEN
        v_to := public.drop_player_spots(v_row.id, v_due * 2);
        UPDATE public.players SET inactive_drift_periods = v_periods, updated_at = now()
        WHERE id = v_row.id;

        IF v_to IS DISTINCT FROM v_from THEN
          INSERT INTO public.admin_alerts (alert_type, headline, detail, player_id)
          VALUES ('inactive_drift',
            v_row.full_name || ' dropped ' || (v_from - v_to) * -1 || ' spots for inactivity.',
            'Inactive ' || floor(v_days) || ' days · #' || v_from || ' → #' || v_to ||
            '. If this is an exception, put them back on the Rankings tab.',
            v_row.id);
          v_dropped := v_dropped || jsonb_build_object(
            'player', v_row.full_name, 'from', v_from, 'to', v_to, 'days', floor(v_days));
        END IF;
      ELSE
        UPDATE public.players SET inactive_drift_periods = v_periods, updated_at = now()
        WHERE id = v_row.id;

        INSERT INTO public.admin_alerts (alert_type, headline, detail, player_id)
        VALUES ('inactive_drift',
          v_row.full_name || ' has been inactive ' || floor(v_days) || ' days.',
          'Under the rules that is ' || (v_due * 2) || ' more spots down the list (currently #'
            || COALESCE(v_from::text, '?') || '). Nobody has been moved. '
            || 'Update the Rankings tab if you want to apply it.',
          v_row.id);
        v_due_list := v_due_list || jsonb_build_object(
          'player', v_row.full_name, 'spots_due', v_due * 2, 'days', floor(v_days));
      END IF;
    END IF;

    IF v_days >= 90 AND NOT EXISTS (
      SELECT 1 FROM public.admin_alerts
      WHERE player_id = v_row.id AND alert_type = 'inactive_90_day' AND acknowledged_at IS NULL
    ) THEN
      INSERT INTO public.admin_alerts (alert_type, headline, detail, player_id)
      VALUES ('inactive_90_day',
        v_row.full_name || ' has been inactive ' || floor(v_days) || ' days.',
        'Past 90 days the rules allow removal from the list at your discretion.',
        v_row.id);
      v_flagged := v_flagged || to_jsonb(v_row.full_name);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'dropped', v_dropped, 'due', v_due_list, 'flagged_90_day', v_flagged, 'at', now());
END;
$$;

COMMENT ON FUNCTION public.apply_inactive_drift() IS
  'Switch-aware (league_settings.automatic_list_changes). ON: two spots per completed 30 days inactive, with an admin alert for each drop. OFF: moves nobody, raises an admin alert saying how many spots are due. The 90-day review alert is raised in both. Idempotent via inactive_drift_periods. Scheduled daily by pg_cron.';
