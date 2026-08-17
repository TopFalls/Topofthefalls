export type Eligibility = { ok: boolean; reason?: string };

/**
 * Positional challenge rules for Top of the Falls. Returns whether you may
 * challenge a given rank and, if not, a short plain-language reason.
 *
 * Single source of truth for the client-side ladder rules (the server enforces
 * them independently in the create-challenge edge function). TOF has no
 * Rank #1 down-obligation — #1 cannot challenge anyone below them.
 */
export function challengeEligibility(myPos: number, theirPos: number): Eligibility {
  if (myPos === theirPos) return { ok: false, reason: 'This is you' };
  if (theirPos > myPos) return { ok: false, reason: 'Ranked below you' };
  if (myPos <= 10) {
    return theirPos === myPos - 1
      ? { ok: true }
      : { ok: false, reason: 'Top 10: one spot up only' };
  }
  return myPos - theirPos <= 2
    ? { ok: true }
    : { ok: false, reason: 'Out of range — two spots up max' };
}

export function canChallenge(myPos: number, theirPos: number): boolean {
  return challengeEligibility(myPos, theirPos).ok;
}

// ─── Inactive players ────────────────────────────────────────────────────────
//
// An inactive player keeps their spot on the list (greyed out, unchallengeable)
// but the challenge rules step straight over them, so the player below can
// reach the player above. Without this, the strict "one spot up only" rule for
// the top 10 would leave whoever sits under an inactive player with no legal
// challenge at all until that player came back.
//
// The rules above are therefore applied to *active rank* — a player's place
// among the active players only — rather than to the raw list position shown
// on screen. The edge function create-challenge derives the same mapping
// server-side; keep the two in step.

export type LadderSlot = { position: number; isActive: boolean };

/**
 * Map each list position to its rank among active players. Inactive positions
 * are absent from the map.
 *
 *   positions 1 2 3 4 5   (3 inactive)
 *   active    1 2 - 3 4
 */
export function activeRankByPosition(slots: LadderSlot[]): Map<number, number> {
  const byPosition = new Map<number, number>();
  let rank = 0;
  for (const slot of [...slots].sort((a, b) => a.position - b.position)) {
    if (!slot.isActive) continue;
    rank += 1;
    byPosition.set(slot.position, rank);
  }
  return byPosition;
}

/**
 * Challenge eligibility by list position, skipping inactive players.
 * `activeRanks` comes from activeRankByPosition over the whole ladder.
 */
export function challengeEligibilityOnLadder(
  myPos: number,
  theirPos: number,
  activeRanks: Map<number, number>,
): Eligibility {
  const theirRank = activeRanks.get(theirPos);
  if (theirRank === undefined) return { ok: false, reason: 'Inactive' };

  const myRank = activeRanks.get(myPos);
  if (myRank === undefined) return { ok: false, reason: "You're inactive" };

  return challengeEligibility(myRank, theirRank);
}

export function canChallengeOnLadder(
  myPos: number,
  theirPos: number,
  activeRanks: Map<number, number>,
): boolean {
  return challengeEligibilityOnLadder(myPos, theirPos, activeRanks).ok;
}
