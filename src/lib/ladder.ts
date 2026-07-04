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
  if (myPos <= 11) {
    return theirPos === myPos - 1
      ? { ok: true }
      : { ok: false, reason: 'Top 11: one spot up only' };
  }
  if (myPos === 12) {
    return theirPos === 11 || theirPos === 10
      ? { ok: true }
      : { ok: false, reason: 'From #12: only #10 or #11' };
  }
  return myPos - theirPos <= 2
    ? { ok: true }
    : { ok: false, reason: 'Out of range — two spots up max' };
}

export function canChallenge(myPos: number, theirPos: number): boolean {
  return challengeEligibility(myPos, theirPos).ok;
}
