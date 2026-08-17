import test from 'node:test';
import assert from 'node:assert/strict';
import {
  challengeEligibility,
  canChallenge,
  activeRankByPosition,
  challengeEligibilityOnLadder,
  canChallengeOnLadder,
} from '../src/lib/ladder.ts';

/** A ladder of `size` positions where `inactive` positions are stood down. */
const ladder = (size, inactive = []) =>
  activeRankByPosition(
    Array.from({ length: size }, (_, i) => ({
      position: i + 1,
      isActive: !inactive.includes(i + 1),
    })),
  );

test('cannot challenge yourself', () => {
  assert.equal(canChallenge(5, 5), false);
  assert.equal(challengeEligibility(5, 5).reason, 'This is you');
});

test('cannot challenge down the ladder', () => {
  assert.equal(canChallenge(3, 7), false);
  assert.equal(challengeEligibility(3, 7).reason, 'Ranked below you');
});

test('TOF has no #1 down-obligation — #1 cannot challenge anyone', () => {
  // Regression: PlayerPage carried a stale TOC rule letting #1 challenge the top 5.
  for (const theirPos of [2, 3, 4, 5]) {
    assert.equal(canChallenge(1, theirPos), false, `#1 must not be able to challenge #${theirPos}`);
  }
});

test('the Top 10 move one spot while #11 can reach #9 and #10', () => {
  assert.equal(canChallenge(10, 9), true);
  assert.equal(canChallenge(10, 8), false);
  assert.equal(challengeEligibility(10, 8).reason, 'Top 10: one spot up only');

  assert.equal(canChallenge(11, 10), true);
  assert.equal(canChallenge(11, 9), true);
  assert.equal(canChallenge(11, 8), false);
});

test('#12 and below may challenge up to two spots up', () => {
  assert.equal(canChallenge(12, 11), true);
  assert.equal(canChallenge(12, 10), true);
  assert.equal(canChallenge(12, 9), false);
  assert.equal(canChallenge(20, 18), true);
  assert.equal(canChallenge(20, 17), false);
  assert.equal(challengeEligibility(20, 17).reason, 'Out of range — two spots up max');
});

// ─── Inactive players ────────────────────────────────────────────────────────
// Inactive players keep their spot on the list but the challenge rules step
// over them, so the player below can reach the player above. Without this the
// Top-10 "one spot up only" rule would leave whoever sits directly under an
// inactive player with no legal challenge at all.

test('active rank skips inactive positions', () => {
  const ranks = ladder(5, [3]);
  assert.deepEqual([...ranks.entries()], [[1, 1], [2, 2], [4, 3], [5, 4]]);
  assert.equal(ranks.has(3), false, 'an inactive position has no active rank');
});

test('the player below an inactive one challenges straight past them', () => {
  const ranks = ladder(12, [6]);
  // #7 is blocked from #6 (inactive) and reaches #5 instead.
  assert.equal(canChallengeOnLadder(7, 6, ranks), false);
  assert.equal(challengeEligibilityOnLadder(7, 6, ranks).reason, 'Inactive');
  assert.equal(canChallengeOnLadder(7, 5, ranks), true);
  // Still only one spot, though — #4 is out of reach.
  assert.equal(canChallengeOnLadder(7, 4, ranks), false);
});

test('without the skip, an inactive player would freeze the one below them', () => {
  // Regression guard for the bug this replaced: on raw positions #7 has no
  // legal challenge at all when #6 is inactive.
  assert.equal(canChallenge(7, 6), true, 'raw rules point #7 at the inactive #6');
  assert.equal(canChallenge(7, 5), false, 'and offer nothing else');
});

test('consecutive inactive players are all skipped', () => {
  const ranks = ladder(12, [5, 6]);
  assert.equal(canChallengeOnLadder(7, 4, ranks), true);
  assert.equal(canChallengeOnLadder(7, 5, ranks), false);
  assert.equal(canChallengeOnLadder(7, 6, ranks), false);
});

test('an inactive player cannot challenge anyone', () => {
  const ranks = ladder(12, [7]);
  assert.equal(canChallengeOnLadder(7, 6, ranks), false);
  assert.equal(challengeEligibilityOnLadder(7, 6, ranks).reason, "You're inactive");
});

test('the Top 10 boundary follows active rank, not list position', () => {
  // Positions 1-12 with #2 inactive: raw #12 is the 11th active player, so it
  // may reach active ranks #10 and #9 under the two-spot rule.
  const ranks = ladder(12, [2]);
  assert.equal(ranks.get(12), 11);
  assert.equal(canChallengeOnLadder(12, 11, ranks), true);  // active 11 -> 10
  assert.equal(canChallengeOnLadder(12, 10, ranks), true);  // active 11 -> 9
  assert.equal(canChallengeOnLadder(12, 9, ranks), false);  // active 11 -> 8
});

test('an all-active ladder behaves exactly as before', () => {
  const ranks = ladder(20);
  for (const [my, their] of [[2, 1], [10, 9], [11, 9], [12, 10], [20, 18]]) {
    assert.equal(canChallengeOnLadder(my, their, ranks), canChallenge(my, their));
  }
  for (const [my, their] of [[4, 2], [10, 8], [11, 8], [12, 9], [20, 17], [3, 7]]) {
    assert.equal(canChallengeOnLadder(my, their, ranks), canChallenge(my, their));
  }
});
