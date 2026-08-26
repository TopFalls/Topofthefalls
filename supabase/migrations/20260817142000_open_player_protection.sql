-- Carl's "open player" rule, from questionnaire B5, L4 and L5.
--
-- His words, joined up:
--
--   B5  "Many" — a player can be challenged by more than one person at once.
--   L4  "If players are engaged in a challenge a player may not challenge the
--        outcome unless there is no open player. If there is an open player in
--        their challenge window they must challenge that player or they are
--        open to challenges from behind."
--   L5  "Players may challenge players involved in matches if there are no
--        open players."
--
-- Read together that is not a prohibition, it is a trade. You may always
-- challenge somebody who is already tied up in a match. But if an *open*
-- player was available in your range and you skipped them to go chase a match
-- result instead, you give up your own protection and anyone below you may
-- challenge you while you wait.
--
-- So:
--   * "engaged"   = tied up in a live challenge or match
--   * "open"      = active, not engaged, not sitting out a cooldown
--   * a challenger is PROTECTED unless they passed over an open player
--   * protected means nobody may challenge you while your challenge is live
--   * the player you challenged is NOT protected — that is what B5 "Many"
--     means, and it is what lets somebody challenge the winner or the loser
--     of a match that is already arranged
--
-- This changes live play for 119 people who are using the app right now, and
-- it rests on reading three free-text answers rather than a rule Carl stated
-- outright. So it ships behind a switch: set `league_settings.open_player_rule`
-- to false and the app reverts to one-challenge-at-a-time with everybody
-- protected, with no deploy needed.

ALTER TABLE public.league_settings
  ADD COLUMN IF NOT EXISTS open_player_rule boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.league_settings.open_player_rule IS
  'On: several people may challenge the same player, and skipping an open player costs you your protection. Off: one incoming challenge at a time, everyone in a challenge is protected.';

ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS challenger_protected boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.challenges.challenger_protected IS
  'False when the challenger passed over an open player to challenge someone already in a match. While false, players below them may challenge them.';

-- ─── Who is tied up right now ───────────────────────────────────────────────
-- One definition, so the edge function and any future SQL cannot drift apart.

CREATE OR REPLACE FUNCTION public.engaged_player_ids()
RETURNS TABLE (player_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.challenger_id FROM public.challenges c
   WHERE c.status IN ('pending', 'accepted', 'scheduled', 'in_progress')
  UNION
  SELECT c.challenged_id FROM public.challenges c
   WHERE c.status IN ('pending', 'accepted', 'scheduled', 'in_progress')
  UNION
  SELECT m.player1_id FROM public.matches m
   WHERE m.status IN ('scheduled', 'in_progress', 'submitted', 'disputed')
  UNION
  SELECT m.player2_id FROM public.matches m
   WHERE m.status IN ('scheduled', 'in_progress', 'submitted', 'disputed');
$$;

COMMENT ON FUNCTION public.engaged_player_ids() IS
  'Players currently tied up in a live challenge or match. Anyone active and not in this set, and not on cooldown, is an "open player".';

REVOKE ALL ON FUNCTION public.engaged_player_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.engaged_player_ids() TO authenticated, service_role;
