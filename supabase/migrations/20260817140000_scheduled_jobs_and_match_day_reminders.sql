-- Two jobs the league needs running on a clock, not by luck.
--
-- 1. Challenge expiry was only ever triggered as a side effect of somebody
--    creating a new challenge (`create-challenge` calls it on the way in). On a
--    quiet week nobody issues a challenge, so nothing expires, and the rule
--    Carl asked for on 2026-08-14 — an ignored challenge counts as a forfeit —
--    simply never fires. It runs hourly now regardless of who is using the app.
--
-- 2. Carl asked for a "match reminder on match day" (questionnaire H1). Both
--    players get one notification the morning of a scheduled match.
--
-- Times are Mountain, because the league is in Great Falls: the reminder job
-- runs at 15:00 UTC, which is 9am MDT.

-- ─── Match-day reminders ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.send_match_day_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matches integer := 0;
  m record;
  v_where text;
BEGIN
  FOR m IN
    SELECT mt.id, mt.player1_id, mt.player2_id, mt.discipline, mt.venue,
           mt.scheduled_at, p1.full_name AS n1, p2.full_name AS n2
    FROM public.matches mt
    JOIN public.players p1 ON p1.id = mt.player1_id
    JOIN public.players p2 ON p2.id = mt.player2_id
    WHERE mt.status = 'scheduled'
      AND mt.scheduled_at IS NOT NULL
      AND (mt.scheduled_at AT TIME ZONE 'America/Denver')::date
        = (now()            AT TIME ZONE 'America/Denver')::date
      -- Never send the same reminder twice, however often the job runs.
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.reference_id = mt.id
          AND n.reference_type = 'match'
          AND n.type = 'match_day_reminder'
          AND n.created_at > now() - interval '20 hours'
      )
  LOOP
    v_where := m.discipline
      || CASE WHEN m.venue IS NOT NULL THEN ' · ' || m.venue ELSE '' END
      || ' · ' || to_char(m.scheduled_at AT TIME ZONE 'America/Denver', 'FMHH12:MIam');

    INSERT INTO public.notifications (player_id, type, title, body, reference_id, reference_type)
    VALUES
      (m.player1_id, 'match_day_reminder', 'You play today',
       m.n2 || ' · ' || v_where, m.id, 'match'),
      (m.player2_id, 'match_day_reminder', 'You play today',
       m.n1 || ' · ' || v_where, m.id, 'match');

    v_matches := v_matches + 1;
  END LOOP;

  RETURN v_matches;
END;
$$;

COMMENT ON FUNCTION public.send_match_day_reminders() IS
  'Notifies both players the morning of a scheduled match. Idempotent within 20 hours, so a re-run does not double-send.';

REVOKE ALL ON FUNCTION public.send_match_day_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_match_day_reminders() TO service_role;

-- ─── Schedules ──────────────────────────────────────────────────────────────

SELECT cron.unschedule('tof-expire-challenges')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tof-expire-challenges');

SELECT cron.unschedule('tof-match-day-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tof-match-day-reminders');

SELECT cron.schedule(
  'tof-expire-challenges', '7 * * * *',
  $job$SELECT public.expire_stale_challenges();$job$
);

SELECT cron.schedule(
  'tof-match-day-reminders', '0 15 * * *',
  $job$SELECT public.send_match_day_reminders();$job$
);
