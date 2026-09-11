-- A loss costs exactly one spot. Never more, never less.
--
-- Carl, stating the rule: "A player can never lose more than one spot for a
-- loss. But a lesser ranked player challenging a higher ranked player gets the
-- spot of that player that was higher, and the higher player always only moves
-- down one. They can never move down less than one."
--
-- The app was doing a straight swap: the winner took the loser's spot and the
-- loser took the winner's. When the two are next to each other that is the same
-- thing, which is why this went unnoticed. When they are not, the loser fell as
-- far as the winner climbed -- and spots 11 and below may challenge two up, so
-- a two-spot fall was a legal, routine outcome.
--
-- Measured on the live project before writing this: of 38 forfeits that moved
-- the ladder, 24 dropped the loser exactly one spot and **14 dropped them two**.
-- Every one of those 14 was a challenge that spanned more than one position.
--
-- The correct move is a rotation, not a swap:
--
--     before   #43 Dan    #44 Jo     #45 Kurt
--     Kurt challenges Dan two up and wins
--     after    #43 Kurt   #44 Dan    #45 Jo
--
-- The winner takes the spot they challenged. The loser moves down one. Anyone
-- the winner passed moves down one as well. Nobody falls further than one spot
-- from a single result.
--
-- A challenger who loses pays nothing on the list. Carl, clarifying the rule:
-- "There's times where a loss doesn't change the list at all, and that's when a
-- player lower on the list challenging a higher ranked player loses. Nothing
-- changes in that situation." Both players stay exactly where they were -- the
-- defender does not climb for holding their spot, and the challenger does not
-- fall for trying. That is the early RETURN below, and it is the common case:
-- the only way to move down the list is to be beaten by somebody below you.
-- (Losing does carry a cooldown -- defend or wait seven days before challenging
-- up again -- but that is a wait, not a position.)
--
-- This function is the one place the ladder moves after a win: submit-result,
-- resolve-dispute and apply_challenge_decline_forfeit all call it, so fixing it
-- here fixes played matches, admin-settled disputes and forfeits together.
--
-- reverse_challenge_decline_forfeit already inverts a rotation. Its fast path
-- fires only when the recorded move was a clean exchange -- which, under this
-- function, is exactly the adjacent case where a rotation and a swap agree --
-- and its other branch is a block shift that is the precise inverse of the
-- rotation below. It needed no change, which is a good sign the rotation is
-- what the schema expected all along.

CREATE OR REPLACE FUNCTION public.cascade_ranking_after_win(p_winner_id uuid, p_loser_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_winner_pos integer;
  v_loser_pos  integer;
BEGIN
  LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE;

  SELECT position INTO v_winner_pos FROM public.rankings WHERE player_id = p_winner_id;
  SELECT position INTO v_loser_pos  FROM public.rankings WHERE player_id = p_loser_id;

  -- The winner was already ahead of the loser, so nothing moves at all. This is
  -- a challenger losing to somebody above them: the defender keeps their spot
  -- and does not climb for holding it, and the challenger keeps theirs and does
  -- not fall for trying. Losing a challenge never costs a spot.
  IF v_winner_pos IS NULL OR v_loser_pos IS NULL OR v_winner_pos <= v_loser_pos THEN
    RETURN;
  END IF;

  -- rankings.position carries a non-deferrable UNIQUE, so the whole affected
  -- block goes out of the live range before anything lands back in it. Same
  -- two-phase move admin_reorder_rankings and admin_remove_player use.
  UPDATE public.rankings
  SET previous_position = position,
      position          = position + 1000,
      updated_at        = now()
  WHERE position BETWEEN v_loser_pos AND v_winner_pos;

  -- The winner takes the spot they challenged.
  UPDATE public.rankings
  SET position = v_loser_pos, updated_at = now()
  WHERE player_id = p_winner_id;

  -- Everyone the winner passed -- the loser first -- moves down exactly one.
  -- The parked block is [1000+loser .. 1000+winner-1] now that the winner has
  -- left it, and -999 lands that on [loser+1 .. winner].
  UPDATE public.rankings
  SET position = position - 999, updated_at = now()
  WHERE position BETWEEN (1000 + v_loser_pos) AND (1000 + v_winner_pos - 1);
END;
$function$;

COMMENT ON FUNCTION public.cascade_ranking_after_win(uuid, uuid) IS
  'Move the ladder after a challenger wins from below: the winner takes the spot they challenged, and everyone they passed -- the loser first -- moves down exactly one. A single loss never costs more than one spot. No-op when the winner was already ahead.';
