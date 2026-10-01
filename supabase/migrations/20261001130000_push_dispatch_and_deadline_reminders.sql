-- Push notifications that reach people with the app closed, and the reminders
-- that make the deadlines useful while nothing moves the list by itself.
--
-- Three pieces:
--
--   1. A dispatcher. Rows written by SQL (cron reminders, admin alerts, league
--      announcements) were never pushed, because only edge functions could send
--      one. A cron job now calls the new `dispatch-push` edge function once a
--      minute, but only when something is waiting. It claims rows atomically, so
--      two overlapping runs can never send the same push twice.
--   2. Deadline reminders for players (24h and 6h before a challenge must be
--      answered or a match must be played) and an admin alert when a match has
--      run past its play-by date.
--   3. Admin pushes. Every admin_alerts row (approaching or overdue deadlines,
--      declines, inactivity, wash requests) is pushed to the admins' devices.
--
-- Notifications that an edge function already pushes itself (challenge received,
-- accepted, result submitted, ...) are deliberately NOT dispatched here; the
-- allowlist below is what keeps them from being pushed twice.
--
-- Nothing is pushed for history: every existing row is marked as pushed first.

-- ─── 1. Plumbing ────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS pushed_at timestamptz;
ALTER TABLE public.admin_alerts  ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

-- A fresh dispatcher must never blast the 350-odd rows that already exist.
UPDATE public.notifications SET pushed_at = now() WHERE pushed_at IS NULL;
UPDATE public.admin_alerts  SET pushed_at = now() WHERE pushed_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_unpushed_idx
  ON public.notifications (created_at) WHERE pushed_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_alerts_unpushed_idx
  ON public.admin_alerts (created_at) WHERE pushed_at IS NULL;

-- The dispatcher is called by pg_cron, not by a browser, so it cannot carry a
-- user's login. It proves itself with a random secret that lives only in the
-- vault. The database makes it here; no person ever has to handle or paste it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'push_dispatch_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'push_dispatch_secret',
      'Sent by the tof-dispatch-push cron job; checked by the dispatch-push edge function.');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.check_push_dispatch_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p_secret, '') <> '' AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'push_dispatch_secret' AND decrypted_secret = p_secret
  );
$$;

REVOKE ALL ON FUNCTION public.check_push_dispatch_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_push_dispatch_secret(text) TO service_role;

-- Which notification types the dispatcher sends. Written once, because the claim
-- function and the cron check must agree: if the cron job looked at a wider set
-- than the dispatcher claims, it would call the edge function every minute
-- forever over rows the dispatcher will never take.
CREATE OR REPLACE FUNCTION public.push_dispatched_types()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'match_day_reminder',
    'league_announcement',
    'challenge_response_due_24h', 'challenge_response_due_6h', 'challenge_response_overdue',
    'match_deadline_24h', 'match_deadline_6h'
  ];
$$;

-- Claim, then send. Marking a row before it is sent means a crash can lose one
-- push (the in-app notification is still there) but can never send two.
CREATE OR REPLACE FUNCTION public.claim_unpushed_notifications(p_limit integer DEFAULT 100)
RETURNS TABLE (id uuid, player_id uuid, type text, title text, body text,
               reference_id uuid, reference_type text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.notifications n
     SET pushed_at = now()
   WHERE n.id IN (
     SELECT x.id FROM public.notifications x
      WHERE x.pushed_at IS NULL
        AND x.type = ANY (public.push_dispatched_types())
      ORDER BY x.created_at
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING n.id, n.player_id, n.type, n.title, n.body, n.reference_id, n.reference_type;
$$;

CREATE OR REPLACE FUNCTION public.claim_unpushed_admin_alerts(p_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, alert_type text, headline text, detail text, challenge_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.admin_alerts a
     SET pushed_at = now()
   WHERE a.id IN (
     SELECT x.id FROM public.admin_alerts x
      WHERE x.pushed_at IS NULL AND x.acknowledged_at IS NULL
      ORDER BY x.created_at
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING a.id, a.alert_type, a.headline, a.detail, a.challenge_id;
$$;

-- Admins have player rows, so their devices live in push_subscriptions like
-- anybody else's. This is the list of whose devices an admin alert goes to.
CREATE OR REPLACE FUNCTION public.push_admin_player_ids()
RETURNS TABLE (player_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pl.id
    FROM public.profiles pr
    JOIN public.players pl ON pl.profile_id = pr.id
   WHERE pr.role IN ('admin', 'super_admin');
$$;

REVOKE ALL ON FUNCTION public.claim_unpushed_notifications(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_unpushed_admin_alerts(integer)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_admin_player_ids()               FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_unpushed_notifications(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_unpushed_admin_alerts(integer)  TO service_role;
GRANT EXECUTE ON FUNCTION public.push_admin_player_ids()               TO service_role;
REVOKE ALL ON FUNCTION public.push_dispatched_types()               FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_dispatched_types()               TO service_role;

-- ─── 2. Deadline reminders ──────────────────────────────────────────────────
-- Reminders only: nothing here changes a ranking, a record or a challenge.

CREATE OR REPLACE FUNCTION public.send_deadline_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_automatic boolean;
  v_total integer := 0;
  v_n integer;
BEGIN
  SELECT COALESCE(automatic_list_changes, false) INTO v_automatic
  FROM public.league_settings LIMIT 1;

  -- The challenged player: 24 hours and 6 hours before the response time ends.
  -- One reminder per window; a challenge first seen inside 6 hours gets only the
  -- 6-hour one.
  INSERT INTO public.notifications (player_id, type, title, body, reference_id, reference_type)
  SELECT c.challenged_id,
         w.kind,
         'Your challenge needs an answer',
         p1.full_name || ' challenged you to ' || c.discipline
           || '. Please accept or decline within about '
           || CASE WHEN w.kind = 'challenge_response_due_6h' THEN '6' ELSE '24' END || ' hours.',
         c.id, 'challenge'
  FROM public.challenges c
  JOIN public.players p1 ON p1.id = c.challenger_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN c.expires_at <= now() + interval '6 hours'
                THEN 'challenge_response_due_6h' ELSE 'challenge_response_due_24h' END AS kind
  ) w
  WHERE c.status = 'pending'
    AND c.expires_at > now()
    AND c.expires_at <= now() + interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.reference_id = c.id AND n.player_id = c.challenged_id AND n.type = w.kind
    );
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  -- Once, when the response time has passed. Only while nothing is automatic:
  -- when forfeits are switched on, the sweep acts instead and this would be noise.
  IF NOT v_automatic THEN
    INSERT INTO public.notifications (player_id, type, title, body, reference_id, reference_type)
    SELECT c.challenged_id,
           'challenge_response_overdue',
           'Your answer is overdue',
           'You have not answered ' || p1.full_name || '''s ' || c.discipline
             || ' challenge. Nothing happens automatically, but please answer when you can.',
           c.id, 'challenge'
    FROM public.challenges c
    JOIN public.players p1 ON p1.id = c.challenger_id
    WHERE c.status = 'pending'
      AND c.expires_at <= now()
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.reference_id = c.id AND n.player_id = c.challenged_id
          AND n.type = 'challenge_response_overdue'
      );
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
  END IF;

  -- Both players: 24 hours and 6 hours before an accepted match must be played.
  -- An unfinished match is one that has not been submitted, confirmed or closed.
  INSERT INTO public.notifications (player_id, type, title, body, reference_id, reference_type)
  SELECT r.player_id,
         w.kind,
         'Your match needs to be played',
         'Your ' || c.discipline || ' match with ' || r.other_name
           || ' needs to be played within about '
           || CASE WHEN w.kind = 'match_deadline_6h' THEN '6' ELSE '24' END || ' hours.',
         COALESCE(m.id, c.id),
         CASE WHEN m.id IS NULL THEN 'challenge' ELSE 'match' END
  FROM public.challenges c
  JOIN public.players p1 ON p1.id = c.challenger_id
  JOIN public.players p2 ON p2.id = c.challenged_id
  LEFT JOIN public.matches m ON m.challenge_id = c.id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN c.match_deadline <= now() + interval '6 hours'
                THEN 'match_deadline_6h' ELSE 'match_deadline_24h' END AS kind
  ) w
  CROSS JOIN LATERAL (VALUES (c.challenger_id, p2.full_name), (c.challenged_id, p1.full_name))
         AS r(player_id, other_name)
  WHERE c.status IN ('accepted', 'scheduled', 'in_progress')
    AND c.match_deadline > now()
    AND c.match_deadline <= now() + interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.matches mm WHERE mm.challenge_id = c.id
        AND (mm.completed_at IS NOT NULL
          OR mm.status IN ('submitted', 'confirming', 'confirmed', 'disputed', 'resolved', 'cancelled'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.reference_id = COALESCE(m.id, c.id) AND n.player_id = r.player_id AND n.type = w.kind
    );
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  -- The admin hears once when a match runs past its play-by date. Nothing
  -- happens to the match or the list; the admin follows up.
  INSERT INTO public.admin_alerts (alert_type, headline, detail, challenge_id, deadline_at)
  SELECT 'challenge_play_overdue',
         p1.full_name || ' vs ' || p2.full_name || ' is past its play-by date',
         c.discipline || ' match. It was due '
           || to_char(c.match_deadline AT TIME ZONE 'America/Denver', 'Mon DD FMHH12:MI AM')
           || ' (Mountain). Nothing on the list has changed. Update the list if necessary.',
         c.id, c.match_deadline
  FROM public.challenges c
  JOIN public.players p1 ON p1.id = c.challenger_id
  JOIN public.players p2 ON p2.id = c.challenged_id
  WHERE c.status IN ('accepted', 'scheduled', 'in_progress')
    AND c.match_deadline <= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.matches mm WHERE mm.challenge_id = c.id
        AND (mm.completed_at IS NOT NULL
          OR mm.status IN ('submitted', 'confirming', 'confirmed', 'disputed', 'resolved', 'cancelled'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_alerts a
      WHERE a.challenge_id = c.id AND a.alert_type = 'challenge_play_overdue'
        AND a.deadline_at = c.match_deadline
    );
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.send_deadline_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_deadline_reminders() TO service_role;

COMMENT ON FUNCTION public.send_deadline_reminders() IS
  'Reminders only. Notifies players 24h and 6h before a challenge must be answered or a match played (and once if an answer is overdue while forfeits are off), and raises one admin alert when a match runs past its play-by date. Changes no ranking, record or challenge. Idempotent: one row per challenge, player and window.';

-- ─── 3. Schedules ───────────────────────────────────────────────────────────

SELECT cron.unschedule('tof-deadline-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tof-deadline-reminders');

SELECT cron.schedule(
  'tof-deadline-reminders', '20 * * * *',
  $job$SELECT public.send_deadline_reminders();$job$
);

SELECT cron.unschedule('tof-dispatch-push')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tof-dispatch-push');

-- Every minute, but it only calls out when something is actually waiting, so a
-- quiet league costs nothing.
SELECT cron.schedule(
  'tof-dispatch-push', '* * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://dpbgdisezxlttwrxqanu.supabase.co/functions/v1/dispatch-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'push_dispatch_secret')),
    body := '{}'::jsonb)
  WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'push_dispatch_secret')
    AND (EXISTS (SELECT 1 FROM public.notifications
                  WHERE pushed_at IS NULL AND type = ANY (public.push_dispatched_types()))
      OR EXISTS (SELECT 1 FROM public.admin_alerts
                  WHERE pushed_at IS NULL AND acknowledged_at IS NULL));
  $job$
);
