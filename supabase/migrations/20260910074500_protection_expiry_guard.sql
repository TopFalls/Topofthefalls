-- Fix, same day as 20260910071500: the rule-OFF branch of protected_player_ids()
-- shielded players whose challenge had already lapsed.
--
-- Found in review. The rule-OFF reading is "one incoming challenge at a time",
-- and it was written to mirror create-challenge's check exactly - status only,
-- no expiry test. That is faithful to the line it copied, but it misses what
-- happens immediately BEFORE that line: create-challenge calls
-- expire_stale_challenges() first, which retires every challenge that is still
-- 'pending' with expires_at in the past. By the time the server looks, a lapsed
-- challenge is already gone from the active set.
--
-- The client cannot call that sweep - it is a write, from a read-only screen -
-- and the cron only runs hourly. So for up to an hour the ladder would hide the
-- Challenge button for somebody the server would happily let you challenge.
-- That is backwards: this lookup is supposed to fail open, never to invent a
-- refusal the server would not make.
--
-- So the OFF branch now applies the sweep's own predicate as a filter. It reads
-- the board as create-challenge would see it, rather than as it sits.
--
-- The rule-ON branch never had this problem: it already tests
-- COALESCE(match_deadline, expires_at) > now(), which excludes a lapsed pending
-- challenge on its own.
--
-- Latent rather than live when it was found: open_player_rule is ON, so the OFF
-- branch returns nothing today. Fixed anyway, because the switch exists to be
-- thrown.

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
    -- safe direction to fail in".
    SELECT COALESCE((SELECT s.open_player_rule FROM public.league_settings s LIMIT 1), false) AS open_player_rule
  )
  -- Rule ON: protection belongs to the player who ISSUED a challenge without
  -- skipping an open player. match_deadline is read BEFORE expires_at, because
  -- an accepted challenge already has expires_at in the past and the other
  -- order would strip the shield off every scheduled match on the board.
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

  -- Rule OFF: one incoming challenge at a time. The second condition is
  -- expire_stale_challenges()'s own predicate, applied as a filter so this
  -- reads the board the way create-challenge does after it runs the sweep.
  SELECT DISTINCT
         c.challenged_id AS player_id,
         'In a challenge'::text AS label,
         'That player already has an active challenge they must resolve first.'::text AS detail
    FROM public.challenges c, rule
   WHERE NOT rule.open_player_rule
     AND c.status IN ('pending', 'accepted', 'scheduled', 'in_progress')
     AND NOT (c.status = 'pending' AND c.expires_at <= now());
$$;

COMMENT ON FUNCTION public.protected_player_ids() IS
  'Players who cannot be challenged right now, with the reason. Single definition of the refusal create-challenge returns, so the ladder can grey the button out instead of letting a player fill in a form that will bounce. Follows league_settings.open_player_rule, and ignores challenges the stale sweep would already have retired.';

REVOKE ALL ON FUNCTION public.protected_player_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protected_player_ids() TO authenticated, service_role;
