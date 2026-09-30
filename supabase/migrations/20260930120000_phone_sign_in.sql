-- Phone-number sign-in.
--
-- Members sign in with a 6-digit code texted to their phone instead of emailed.
-- A phone-only sign-up has no email, and profiles.email was NOT NULL, so the
-- signup trigger would fail and the player could never get in. This makes email
-- optional, records the phone number, and lets handle_new_user copy it.
--
-- Additive and reversible: no rows are changed, and email accounts that already
-- exist keep working. The Carl super_admin bootstrap by email is left exactly as
-- it was; an admin who moves to phone is re-linked by hand once their number is
-- known (see the change-log entry).

ALTER TABLE public.profiles ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;

-- One account per number. Partial, so the many email-only rows do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_key
  ON public.profiles (phone) WHERE phone IS NOT NULL;

-- Fires AFTER INSERT ON auth.users; creates the matching profile row.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, phone, role)
  VALUES (
    NEW.id,
    NULLIF(NEW.email, ''),
    NULLIF(NEW.phone, ''),
    CASE
      WHEN lower(NEW.email) = 'cj_higgins@msn.com' THEN 'super_admin'
      ELSE 'player'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
