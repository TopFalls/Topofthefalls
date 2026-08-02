-- Restore the standard Supabase API role grants on public tables.
--
-- Tables created during this instance's bootstrap (applied via the Supabase
-- management API rather than `supabase db push`) did not pick up the
-- platform's default table privileges for the API roles, so every anon and
-- authenticated read failed with 42501 regardless of RLS. Re-apply the
-- platform-standard model: broad table grants, with RLS as the access control.
--
-- Deliberately does NOT touch function grants: the SECURITY DEFINER rank
-- mutators stay locked to service_role per 20260517035030 (verified denied
-- for anon after this migration ran).

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Future tables created by postgres get the same treatment.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

-- Re-assert the deliberate exception from 20260626121000: the API roles may
-- not write profiles except the owner's display_name (blocks role
-- self-escalation at the privilege layer).
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;
