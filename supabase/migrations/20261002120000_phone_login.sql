-- Phone-number sign-in. Email is no longer how anyone gets into the app.
--
-- Every member picks their name from the list and signs in with a phone number and
-- a 4-digit PIN. (The sign-in goes by the player's id, so a misspelt or later
-- renamed name cannot break it.) The
-- app never asks for, shows, sends or uses an email address.
--
-- Supabase Auth still needs some identifier on each account, so accounts made
-- from here on carry an invisible placeholder address that nothing is ever sent
-- to. Existing accounts keep whatever they have; the app just stops using it.
-- Stored real addresses are left untouched on purpose: they are deleted later,
-- by a separate decision, once everyone has switched over.
--
-- What this adds:
--   login_credentials  one row per member who can sign in: salted hash of
--                      phone + PIN, last four digits of the phone for admins.
--   login_requests     a signed-out member asking to be let in. Carl or Mike
--                      approves it once; the phone number sits here in the clear
--                      only until that decision, so the admin can ring them back.
--   login_attempts     a counter that locks a player or an address out after too
--                      many wrong tries, for longer each time.
--
-- None of these tables is readable or writable by the browser. Only the edge
-- functions (service_role) touch them, so a PIN guess has to go through the
-- lockout. `my_login_status()` is the one thing a signed-in browser may ask.

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_credentials (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  player_id      uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  secret_hash    text NOT NULL,
  phone_last4    text NOT NULL CHECK (phone_last4 ~ '^[0-9]{4}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS login_credentials_player   ON public.login_credentials (player_id);

-- ---------------------------------------------------------------------------
-- Requests from signed-out members, waiting for an admin
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  phone        text,                      -- cleared the moment an admin decides
  phone_last4  text NOT NULL CHECK (phone_last4 ~ '^[0-9]{4}$'),
  secret_hash  text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS login_requests_pending ON public.login_requests (player_id) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Lockout counters
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_attempts (
  key               text PRIMARY KEY,
  failures          integer NOT NULL DEFAULT 0,
  strikes           integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.login_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts    ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: with row security on and nothing allowed, only
-- service_role (which bypasses it) can read or write these.
REVOKE ALL ON public.login_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.login_requests    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.login_attempts    FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.login_credentials TO service_role;
GRANT ALL ON public.login_requests    TO service_role;
GRANT ALL ON public.login_attempts    TO service_role;

-- ---------------------------------------------------------------------------
-- Lockout. One call per try, made BEFORE the secret is checked, so a burst of
-- parallel guesses cannot all slip in ahead of the counter.
--   p_max     tries allowed inside the window
--   p_window  how long a run of tries is counted for
--   p_lock    first lock; doubles with each further lock, capped at 24 hours,
--             and forgotten after a day of quiet
-- Returns false when the caller is locked out (or has just become so).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.login_begin_attempt(
  p_key    text,
  p_max    integer,
  p_window interval,
  p_lock   interval
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r      public.login_attempts;
  now_ts timestamptz := now();
BEGIN
  INSERT INTO public.login_attempts (key) VALUES (p_key) ON CONFLICT (key) DO NOTHING;
  SELECT * INTO r FROM public.login_attempts WHERE key = p_key FOR UPDATE;

  IF r.locked_until IS NOT NULL AND r.locked_until > now_ts THEN
    RETURN false;
  END IF;

  IF r.updated_at < now_ts - interval '24 hours' THEN
    r.strikes := 0;
  END IF;
  IF r.window_started_at < now_ts - p_window THEN
    r.failures := 0;
    r.window_started_at := now_ts;
  END IF;

  r.failures := r.failures + 1;

  IF r.failures > p_max THEN
    UPDATE public.login_attempts
       SET failures = 0,
           strikes = r.strikes + 1,
           window_started_at = now_ts,
           locked_until = now_ts + least(p_lock * power(2, r.strikes)::double precision, interval '24 hours'),
           updated_at = now_ts
     WHERE key = p_key;
    RETURN false;
  END IF;

  UPDATE public.login_attempts
     SET failures = r.failures,
         strikes = r.strikes,
         window_started_at = r.window_started_at,
         locked_until = NULL,
         updated_at = now_ts
   WHERE key = p_key;
  RETURN true;
END;
$$;

-- A correct sign-in wipes that name's counter. Never used for the address
-- counter: someone guessing from one address should not get a clean slate by
-- signing in once as themselves.
CREATE OR REPLACE FUNCTION public.login_clear_attempts(p_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.login_attempts WHERE key = p_key
$$;

-- Counters are only useful while they are fresh.
CREATE OR REPLACE FUNCTION public.login_prune_attempts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.login_attempts
   WHERE updated_at < now() - interval '7 days'
     AND (locked_until IS NULL OR locked_until < now())
$$;

REVOKE ALL ON FUNCTION public.login_begin_attempt(text, integer, interval, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.login_clear_attempts(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.login_prune_attempts()     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_begin_attempt(text, integer, interval, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.login_clear_attempts(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.login_prune_attempts()     TO service_role;

SELECT cron.unschedule('tof-prune-login-attempts')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tof-prune-login-attempts');
SELECT cron.schedule('tof-prune-login-attempts', '40 4 * * *', $cron$SELECT public.login_prune_attempts();$cron$);

-- ---------------------------------------------------------------------------
-- The one question a signed-in browser may ask: "have I switched to phone
-- sign-in yet?" It returns a yes or a no and nothing else.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_login_status()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.login_credentials WHERE user_id = auth.uid())
$$;

REVOKE ALL ON FUNCTION public.my_login_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_login_status() TO authenticated, service_role;

COMMENT ON TABLE public.login_credentials IS
  'Phone + PIN sign-in. Hash only; never readable by the browser. See 20261002120000_phone_login.sql.';
COMMENT ON TABLE public.login_requests IS
  'Signed-out members waiting for an admin to let them in. phone is cleared when decided.';
