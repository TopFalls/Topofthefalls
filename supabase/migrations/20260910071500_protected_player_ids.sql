-- Publish "who is protected" so the challenge screen can say so before a
-- player taps.
--
-- The open-player rule (20260817142000) gave a challenger a shield, and the
-- create-challenge edge function refuses a challenge against a shielded
-- player with a 409. Nothing ever told the client, so the ladder showed a
-- Challenge button on a protected player, the challenger walked the whole
-- three-step form, and only the submit came back refused. Right now that is
-- 18 of the people on the list.
--
-- The obvious fix is to work protection out in the browser. That would put a
-- second copy of a subtle, live rule in TypeScript, and this repo has been
-- bitten by exactly that before -- which is why engaged_player_ids() exists at
-- all, and why its comment promises to be the single definition so "the edge
-- function and any future SQL cannot drift apart". This is that future SQL.
--
-- So the predicate lives here once, and both sides read it: create-challenge
-- returns `detail` as its refusal, and the client shows `label` on the ladder
-- and `detail` where there is room for a sentence. The words a player sees
-- have one source too.

-- Deliberately SECURITY INVOKER (the default), unlike engaged_player_ids()
-- next door. That one was granted to `authenticated` as a SECURITY DEFINER and
-- had to be walked back in 20260817144000, because it unions in `matches` and
-- so handed every signed-in player more than the tables themselves would show
-- them. This function reads only `challenges` and `league_settings`, and
-- `authenticated` already holds SELECT on both with a USING (true) policy —
-- verified live, along with `anon` holding SELECT on neither. So running as the
-- caller returns exactly what the caller could have queried by hand, and if
-- those policies are ever tightened this narrows with them instead of leaking
-- past them.
CREATE OR REPLACE FUNCTION public.protected_player_ids()
RETURNS TABLE (player_id uuid, label text, detail text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH rule AS (
    -- Default false, matching create-challenge: `ruleRow?.open_player_rule
    -- === true` reads a missing row as OFF, and its comment calls that "the
    -- safe direction to fail in". The two must fail the same way or they would
    -- disagree about who is protected at the worst possible moment.
    SELECT COALESCE((SELECT s.open_player_rule FROM public.league_settings s LIMIT 1), false) AS open_player_rule
  )
  -- Rule ON: protection belongs to the player who ISSUED a challenge without
  -- skipping an open player. The player they challenged stays challengeable --
  -- that is what B5 "Many" means.
  --
  -- It has to run out, too. Only 'pending' challenges are ever expired, so a
  -- challenge that was accepted and then never played would otherwise shield
  -- its challenger forever. The deadline to actually play is the end of it,
  -- and match_deadline is checked BEFORE expires_at: once a challenge is
  -- accepted its expires_at is already in the past, so reading that first
  -- would strip the shield off every scheduled match on the board.
  SELECT DISTINCT
         c.challenger_id AS player_id,
         'Protected'::text AS label,
         'That player has a challenge of their own running, and they took the open player when they made it. They are protected until it is played.'::text AS detail
    FROM public.challenges c, rule
   WHERE rule.open_player_rule
     AND c.status IN ('pending', 'accepted', 'scheduled', 'in_progress')
     AND c.challenger_protected IS DISTINCT FROM false
     AND (COALESCE(c.match_deadline, c.expires_at) IS NULL
          OR COALESCE(c.match_deadline, c.expires_at) > now())

  UNION

  -- Rule OFF: one incoming challenge at a time, so anyone already being
  -- challenged is off limits until they resolve it. A different predicate on a
  -- different side of the challenge, which is why the two are not merged.
  SELECT DISTINCT
         c.challenged_id AS player_id,
         'In a challenge'::text AS label,
         'That player already has an active challenge they must resolve first.'::text AS detail
    FROM public.challenges c, rule
   WHERE NOT rule.open_player_rule
     AND c.status IN ('pending', 'accepted', 'scheduled', 'in_progress');
$$;

COMMENT ON FUNCTION public.protected_player_ids() IS
  'Players who cannot be challenged right now, with the reason. Single definition of the refusal create-challenge returns, so the ladder can grey the button out instead of letting a player fill in a form that will bounce. Follows league_settings.open_player_rule.';

-- Signed-out visitors cannot challenge anybody, and the guest surface is
-- deliberately six views and nothing else. Keep anon out of it. As an invoker
-- function it would return them nothing anyway — anon has no SELECT on
-- `challenges` — but the two guards are cheap and say the intent out loud.
REVOKE ALL ON FUNCTION public.protected_player_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protected_player_ids() TO authenticated, service_role;
