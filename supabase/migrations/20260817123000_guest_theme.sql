-- Guests should see the league's colours, not the fallback.
--
-- ThemeProvider reads `theme_name` before anything knows whether there is a
-- session, and after 20260817122000 the `anon` role can no longer read
-- `league_settings`. It fails soft — logs and falls back to DEFAULT_THEME —
-- which today happens to be the same 'emerald-forest' the league is set to, so
-- nothing looked wrong. The moment Carl picks a different theme, every guest
-- would keep seeing the old one and nobody would know why.
--
-- One column, readable by everyone, and the provider stops needing the table.

CREATE OR REPLACE VIEW public.public_league_settings AS
SELECT s.theme_name
FROM public.league_settings s;

ALTER VIEW public.public_league_settings
  SET (security_invoker = false, security_barrier = true);

REVOKE ALL ON public.public_league_settings FROM anon, authenticated;
GRANT SELECT ON public.public_league_settings TO anon, authenticated;

COMMENT ON VIEW public.public_league_settings IS
  'Just the theme name. league_settings also holds fee and scheduling config that no signed-out visitor needs.';
