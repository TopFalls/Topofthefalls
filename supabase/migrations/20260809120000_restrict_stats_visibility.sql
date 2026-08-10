-- Player records become private.
--
-- Carl's rule: league-wide stats are for admins, and each player sees their own
-- numbers and nobody else's. Until now every stats table carried a
-- `USING (true)` read policy, so any signed-in player — or anyone with the anon
-- key — could read all 117 players' records straight from the API. The admin
-- dashboard's role check lived only in the browser (AdminStatsPage.tsx), which
-- is a UI convenience, not access control.
--
-- Locked down here:
--   player_season_stats      own row or admin
--   player_discipline_stats  own row or admin
--   matches                  own matches or admin
--
-- Deliberately left public, because they are ladder state rather than personal
-- records: players, rankings, player_reference_metrics (Fargo), challenges,
-- cooldowns, league_settings, activity_feed. Note that activity_feed headlines
-- do announce individual results ("A def. B · 7–5"); locking that down is a
-- separate decision because it would empty the home page.
--
-- Edge functions are unaffected — they all use the service role and bypass RLS.

-- ─── Helpers ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so the policies below stay a single indexed lookup per
-- statement rather than re-running a correlated subquery per row.

CREATE OR REPLACE FUNCTION public.is_league_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$;

COMMENT ON FUNCTION public.is_league_admin() IS
  'True when the calling user is an admin or super_admin. Used by the stats visibility policies.';

CREATE OR REPLACE FUNCTION public.owns_player(p_player_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players
    WHERE id = p_player_id AND profile_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.owns_player(uuid) IS
  'True when the calling user has claimed the given player row.';

REVOKE ALL ON FUNCTION public.is_league_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owns_player(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_league_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owns_player(uuid) TO authenticated, service_role;

-- ─── player_season_stats ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Anyone can view stats" ON public.player_season_stats;
DROP POLICY IF EXISTS "Own stats or admin" ON public.player_season_stats;

CREATE POLICY "Own stats or admin"
  ON public.player_season_stats
  FOR SELECT
  TO authenticated
  USING (public.is_league_admin() OR public.owns_player(player_id));

REVOKE ALL ON TABLE public.player_season_stats FROM anon;

-- ─── player_discipline_stats ────────────────────────────────────────────────

DROP POLICY IF EXISTS "Anyone can view discipline stats" ON public.player_discipline_stats;
DROP POLICY IF EXISTS "Own discipline stats or admin" ON public.player_discipline_stats;

CREATE POLICY "Own discipline stats or admin"
  ON public.player_discipline_stats
  FOR SELECT
  TO authenticated
  USING (public.is_league_admin() OR public.owns_player(player_id));

REVOKE ALL ON TABLE public.player_discipline_stats FROM anon;

-- ─── matches ────────────────────────────────────────────────────────────────
-- A match list is a record, so it follows the same rule. Every non-admin match
-- query in the app is already scoped to the signed-in player (HomePage,
-- MatchesPage, MatchPage); the one exception was another player's profile,
-- which no longer shows a history. Head-to-head still works, because those
-- matches have the viewer as a participant.

DROP POLICY IF EXISTS "Anyone can view matches" ON public.matches;
DROP POLICY IF EXISTS "Own matches or admin" ON public.matches;

CREATE POLICY "Own matches or admin"
  ON public.matches
  FOR SELECT
  TO authenticated
  USING (
    public.is_league_admin()
    OR public.owns_player(player1_id)
    OR public.owns_player(player2_id)
  );

REVOKE ALL ON TABLE public.matches FROM anon;
