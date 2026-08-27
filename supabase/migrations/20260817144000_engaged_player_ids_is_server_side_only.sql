-- engaged_player_ids() is only ever called by create-challenge, which runs on
-- the service role. Granting it to `authenticated` handed every signed-in
-- player a SECURITY DEFINER function returning who is tied up league-wide,
-- which is more than the challenges table itself would show them and more than
-- anything needs. The database linter flags it, correctly.
REVOKE ALL ON FUNCTION public.engaged_player_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.engaged_player_ids() TO service_role;
