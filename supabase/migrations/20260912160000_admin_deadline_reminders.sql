-- Admin reminders use admin_alerts so administrators need no player profile.
-- One shared alert per challenge, deadline kind and deadline instant.
ALTER TABLE public.admin_alerts
  ADD COLUMN IF NOT EXISTS challenge_id uuid REFERENCES public.challenges(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz;

CREATE UNIQUE INDEX admin_alerts_deadline_once_idx
  ON public.admin_alerts (challenge_id, alert_type, deadline_at)
  WHERE alert_type IN ('challenge_response_deadline', 'challenge_play_deadline');

CREATE OR REPLACE FUNCTION public.send_admin_deadline_reminders()
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
    d.alert_type,
    CASE WHEN d.alert_type = 'challenge_response_deadline'
      THEN 'Challenge response due soon'
      ELSE 'Match play deadline due soon' END,
    p1.full_name || ' vs ' || p2.full_name || ' - ' || c.discipline || '. '
      || CASE WHEN d.alert_type = 'challenge_response_deadline'
        THEN 'Response required by ' ELSE 'Match must be played by ' END
      || to_char(d.deadline_at AT TIME ZONE 'America/Denver', 'Mon DD, YYYY FMHH12:MI AM')
      || ' (Mountain time).',
    c.id,
    d.deadline_at
  FROM public.challenges c
  JOIN public.players p1 ON p1.id = c.challenger_id
  JOIN public.players p2 ON p2.id = c.challenged_id
  CROSS JOIN LATERAL (
    SELECT 'challenge_response_deadline'::text AS alert_type, c.expires_at AS deadline_at
    WHERE c.status = 'pending'
    UNION ALL
    SELECT 'challenge_play_deadline'::text, c.match_deadline
    WHERE c.status IN ('accepted', 'scheduled', 'in_progress')
      -- The match can advance before its challenge row is updated.
      AND NOT EXISTS (
        SELECT 1 FROM public.matches m WHERE m.challenge_id = c.id
          AND (m.completed_at IS NOT NULL
            OR m.status IN ('submitted', 'confirming', 'confirmed', 'disputed', 'resolved', 'cancelled'))
      )
  ) d
  WHERE d.deadline_at > now()
    AND d.deadline_at <= now() + interval '12 hours'
  -- The unique index protects concurrent runs and keeps Done alerts suppressed.
  -- A renewed deadline (for example after a reversed forfeit) gets a new alert.
  ON CONFLICT (challenge_id, alert_type, deadline_at)
    WHERE alert_type IN ('challenge_response_deadline', 'challenge_play_deadline')
    DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.send_admin_deadline_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_admin_deadline_reminders() TO service_role;

COMMENT ON FUNCTION public.send_admin_deadline_reminders() IS
  'Shared admin-only reminders in the final 12 hours before a pending response or unfinished match play deadline. Repeated runs do not duplicate a deadline.';

SELECT cron.unschedule('tof-admin-deadline-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tof-admin-deadline-reminders');

SELECT cron.schedule(
  'tof-admin-deadline-reminders', '0 * * * *',
  $job$SELECT public.send_admin_deadline_reminders();$job$
);
