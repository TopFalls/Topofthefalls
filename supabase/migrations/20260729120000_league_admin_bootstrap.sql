-- Admin bootstrap for THIS league's instance.
--
-- The upstream codebase this repo was seeded from hardcoded four personal email
-- addresses into the signup triggers: one developer account granted super_admin
-- and three unrelated operators granted admin. Those people have no role in this
-- league and must not receive elevated access on this database.
--
-- This migration supersedes:
--   20260321141653_auto_assign_admin_roles.sql  (assign_admin_on_signup)
--   20260321143621_update_admin_auto_assign.sql (assign_admin_on_signup)
--   20260321144334_fix_profile_creation.sql     (handle_new_user)
--
-- Both triggers stay in place; only the email -> role mapping changes.
-- Carl Higgins is the league operator and is the sole super_admin. Per the
-- established claim flow, this role is granted on first login and is independent
-- of claiming his player row on the roster.

-- Fires BEFORE INSERT ON profiles.
CREATE OR REPLACE FUNCTION assign_admin_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  -- Carl Higgins = league operator = super_admin
  IF lower(NEW.email) = 'cj_higgins@msn.com' THEN
    NEW.role := 'super_admin';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Fires AFTER INSERT ON auth.users; creates the matching profile row.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE
      WHEN lower(NEW.email) = 'cj_higgins@msn.com' THEN 'super_admin'
      ELSE 'player'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Promote Carl if he has already signed in before this migration ran.
UPDATE public.profiles
SET role = 'super_admin'
WHERE lower(email) = 'cj_higgins@msn.com'
  AND role IS DISTINCT FROM 'super_admin';

-- Defensive: strip any elevated role inherited from the upstream league's
-- hardcoded admin list. No-op on a clean database.
UPDATE public.profiles
SET role = 'player'
WHERE lower(email) IN (
  'chase.dalin@gmail.com',
  'aldermancompanies@gmail.com',
  'no1patsfan1981@yahoo.com',
  'ecroft@bresnan.net'
)
AND role IS DISTINCT FROM 'player';

INSERT INTO public.audit_events (action, target_type, detail)
VALUES (
  'league_admin_bootstrap',
  'profiles',
  jsonb_build_object(
    'super_admin', 'cj_higgins@msn.com',
    'note', 'Upstream hardcoded admin emails removed; sole super_admin is the league operator.'
  )
);
