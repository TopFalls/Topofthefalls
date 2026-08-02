-- Clear the security_definer_view advisor ERRORs on the admin dashboard views.
--
-- Same treatment 20260626122000 applied to the treasury views: these four
-- reporting views were added later (20260628120000) as SECURITY DEFINER and
-- missed that pass. Every table they read already has a public SELECT policy
-- (rankings, players, player_reference_metrics, player_season_stats,
-- challenges, matches, league_settings, treasury via its invoker views), so
-- honoring the caller's RLS changes nothing about who can read them — the
-- views remain granted to authenticated/service_role only.
alter view public.admin_dashboard_leaderboard set (security_invoker = true);
alter view public.admin_dashboard_challenges set (security_invoker = true);
alter view public.admin_dashboard_matches set (security_invoker = true);
alter view public.admin_dashboard_league_overview set (security_invoker = true);
