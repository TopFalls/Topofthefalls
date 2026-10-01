-- Nothing moves the list on its own any more. Admins decide.
--
-- Carl's league now runs with the admins in full manual control of the list, so
-- no deadline may change a ranking, a record or a cooldown by itself:
--
--   a. An unanswered challenge used to be forfeited when its 48 hours ran out
--      (hourly job 'tof-expire-challenges' -> expire_stale_challenges()).
--      It now just stays open. The admin is told it is overdue, once.
--   b. An inactive player used to drop two spots per 30 days (daily job
--      'tof-inactive-drift' -> apply_inactive_drift()). It now only tells the
--      admin that a drop is due under the rules; nobody is moved.
--   c. Declining a challenge used to count as a forfeit (handled in the
--      respond-to-challenge edge function, not here). That function now records a
--      plain decline and raises an admin alert. See the edge function.
--
-- The 7-day wait after a lost match is untouched: it only blocks issuing a new
-- challenge and moves nobody.
--
-- Forfeits already recorded stay reversible (reverse_challenge_decline_forfeit
-- and apply_challenge_decline_forfeit are left alone for the admin tools).

-- ─── a. Overdue challenges: tell the admin, change nothing ───────────────────

CREATE OR REPLACE FUNCTION public.flag_overdue_challenges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
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
    -- One alert per challenge and deadline, however often the job runs.
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_alerts a
      WHERE a.challenge_id = c.id
        AND a.alert_type = 'challenge_overdue'
        AND a.deadline_at = c.expires_at
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.flag_overdue_challenges() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_overdue_challenges() TO service_role;

COMMENT ON FUNCTION public.flag_overdue_challenges() IS
  'Raises one admin alert per overdue pending challenge. Changes no ranking, record, cooldown or challenge status. Safe to call repeatedly.';

-- The old name stays callable and does nothing, so an edge function build that
-- still calls it before this migration is rolled out cannot forfeit anybody.
CREATE OR REPLACE FUNCTION public.expire_stale_challenges()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT 0; $$;

COMMENT ON FUNCTION public.expire_stale_challenges() IS
  'Retired no-op. Overdue challenges no longer expire or forfeit; see flag_overdue_challenges().';

-- ─── b. Inactive players: tell the admin, change nothing ────────────────────

CREATE OR REPLACE FUNCTION public.apply_inactive_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_days numeric;
  v_periods integer;
  v_due integer;
  v_position integer;
  v_due_list jsonb := '[]'::jsonb;
  v_flagged jsonb := '[]'::jsonb;
BEGIN
  FOR v_row IN
    SELECT p.id, p.full_name, p.inactive_since, p.inactive_drift_periods
    FROM public.players p
    JOIN public.rankings r ON r.player_id = p.id
    WHERE p.is_active = false AND p.inactive_since IS NOT NULL
    ORDER BY r.position
  LOOP
    v_days := EXTRACT(EPOCH FROM (now() - v_row.inactive_since)) / 86400.0;
    v_periods := floor(v_days / 30.0);
    -- inactive_drift_periods now means "30-day periods already reported".
    v_due := v_periods - COALESCE(v_row.inactive_drift_periods, 0);

    IF v_due > 0 THEN
      SELECT position INTO v_position FROM public.rankings WHERE player_id = v_row.id;
      UPDATE public.players
         SET inactive_drift_periods = v_periods, updated_at = now()
       WHERE id = v_row.id;

      INSERT INTO public.admin_alerts (alert_type, headline, detail, player_id)
      VALUES ('inactive_drift',
        v_row.full_name || ' has been inactive ' || floor(v_days) || ' days.',
        'Under the rules that is ' || (v_due * 2) || ' more spots down the list (currently #'
          || COALESCE(v_position::text, '?') || '). Nobody has been moved. '
          || 'Update the Rankings tab if you want to apply it.',
        v_row.id);
      v_due_list := v_due_list || jsonb_build_object(
        'player', v_row.full_name, 'spots_due', v_due * 2, 'days', floor(v_days));
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

  RETURN jsonb_build_object('due', v_due_list, 'flagged_90_day', v_flagged, 'at', now());
END;
$$;

COMMENT ON FUNCTION public.apply_inactive_drift() IS
  'Despite the historic name this moves nobody. Raises one admin alert per completed 30 days of inactivity (the drop that is due under the rules) and a 90-day review alert. Idempotent via inactive_drift_periods. Scheduled daily by pg_cron.';

-- ─── Schedules ──────────────────────────────────────────────────────────────
-- 'tof-inactive-drift' keeps running: it now only raises alerts.

SELECT cron.unschedule('tof-expire-challenges')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tof-expire-challenges');

SELECT cron.unschedule('tof-flag-overdue-challenges')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tof-flag-overdue-challenges');

SELECT cron.schedule(
  'tof-flag-overdue-challenges', '7 * * * *',
  $job$SELECT public.flag_overdue_challenges();$job$
);
