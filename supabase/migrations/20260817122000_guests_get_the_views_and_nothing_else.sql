-- Make "view only" true for signed-out visitors.
--
-- Supabase ships every new project with
--   GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
-- and leans entirely on RLS to hold the line. This project still carried that
-- default, so the `anon` role held INSERT, UPDATE, DELETE and TRUNCATE on 15
-- tables including `players`, `rankings` and `activity_feed`. Nothing has been
-- written — every one of those tables denies writes at the policy layer, and
-- that was checked before this ran — but a single permissive policy added in
-- future would be the only thing between an anonymous request and the roster.
--
-- The same default also meant guests could already read the whole `players`
-- table, every column, current and future. That is how a column added for
-- league admin convenience ends up on the open internet.
--
-- So: `anon` loses everything, and gets back SELECT on the five guest views
-- from 20260817121000 and nothing more. Those views name their columns
-- explicitly, so this is now a surface someone has to opt into on purpose.
--
-- `authenticated` is untouched — players and admins keep working exactly as
-- they do today, gated by RLS as before.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

GRANT SELECT ON public.public_players        TO anon;
GRANT SELECT ON public.public_rankings       TO anon;
GRANT SELECT ON public.public_player_metrics TO anon;
GRANT SELECT ON public.public_activity_feed  TO anon;
GRANT SELECT ON public.public_live_matches   TO anon;

-- Without this, the next `CREATE TABLE` in a migration silently re-grants the
-- whole table to anonymous callers and undoes the paragraph above.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
