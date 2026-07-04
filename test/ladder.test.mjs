import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeEligibility, canChallenge } from '../src/lib/ladder.ts';

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

test('top 11 may only challenge one spot up', () => {
  assert.equal(canChallenge(2, 1), true);
  assert.equal(canChallenge(11, 10), true);
  assert.equal(canChallenge(11, 9), false);
  assert.equal(canChallenge(4, 2), false);
  assert.equal(challengeEligibility(4, 2).reason, 'Top 11: one spot up only');
});

test('#12 may challenge #11 or #10 only', () => {
  assert.equal(canChallenge(12, 11), true);
  assert.equal(canChallenge(12, 10), true);
  assert.equal(canChallenge(12, 9), false);
  assert.equal(challengeEligibility(12, 9).reason, 'From #12: only #10 or #11');
});

test('13 and below may challenge up to two spots up', () => {
  assert.equal(canChallenge(13, 12), true);
  assert.equal(canChallenge(13, 11), true);
  assert.equal(canChallenge(13, 10), false);
  assert.equal(canChallenge(20, 18), true);
  assert.equal(canChallenge(20, 17), false);
  assert.equal(challengeEligibility(20, 17).reason, 'Out of range — two spots up max');
});
