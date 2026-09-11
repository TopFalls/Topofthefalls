import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const migrationDir = join(root, 'supabase', 'migrations');

function migrationMatching(fragment) {
  const name = readdirSync(migrationDir).find((file) => file.includes(fragment));
  assert.ok(name, `expected a migration matching "${fragment}"`);
  return readFileSync(join(migrationDir, name), 'utf8');
}

const rotation = migrationMatching('a_loss_costs_exactly_one_spot');

// Carl's rule, verbatim: "A player can never lose more than one spot for a loss.
// But a lesser ranked player challenging a higher ranked player gets the spot of
// that player that was higher, and the higher player always only moves down one.
// They can never move down less than one."
//
// The app used to swap the two players, so the loser fell as far as the winner
// climbed. Spots 11 and below may challenge two up, so a two-spot fall was a
// legal, routine outcome -- 14 of 38 ladder-moving forfeits on the live project
// did exactly that before this landed.

// A pure model of the rotation, so the arithmetic is checked rather than the
// SQL being eyeballed. Positions are 1..n, smaller is better.
function applyWin(ladder, winner, loser) {
  const w = ladder.indexOf(winner) + 1;
  const l = ladder.indexOf(loser) + 1;
  if (w <= l) return ladder.slice(); // defender held; nothing moves
  const next = ladder.slice();
  next.splice(w - 1, 1);          // winner leaves their spot
  next.splice(l - 1, 0, winner);  // and takes the one they challenged
  return next;
}

test('the winner takes the spot they challenged, over any legal gap', () => {
  const before = ['Dan', 'Jo', 'Kurt'];              // #43 #44 #45
  const after = applyWin(before, 'Kurt', 'Dan');     // Kurt challenges two up
  assert.equal(after.indexOf('Kurt') + 1, 1, 'winner takes the challenged spot');
});

test('the loser moves down exactly one, never further', () => {
  const before = ['Dan', 'Jo', 'Kurt'];
  const after = applyWin(before, 'Kurt', 'Dan');
  assert.equal(after.indexOf('Dan') + 1, 2, 'loser drops one, not two');
});

test('a player the winner passed also moves down exactly one', () => {
  const before = ['Dan', 'Jo', 'Kurt'];
  const after = applyWin(before, 'Kurt', 'Dan');
  assert.equal(after.indexOf('Jo') + 1, 3, 'the passed player drops one');
});

test('nobody ever drops more than one spot from a single result', () => {
  // Every legal challenge gap, over a ladder long enough to expose a cascade.
  const before = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
  for (let gap = 1; gap <= 5; gap += 1) {
    for (let w = gap + 1; w <= before.length; w += 1) {
      const winner = before[w - 1];
      const loser = before[w - 1 - gap];
      const after = applyWin(before, winner, loser);
      for (const name of before) {
        const wasAt = before.indexOf(name) + 1;
        const nowAt = after.indexOf(name) + 1;
        const dropped = nowAt - wasAt;
        assert.ok(dropped <= 1, `${name} dropped ${dropped} spots (gap ${gap})`);
      }
    }
  }
});

test('a defender beaten from below always drops exactly one, never zero', () => {
  const before = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
  for (let gap = 1; gap <= 5; gap += 1) {
    for (let w = gap + 1; w <= before.length; w += 1) {
      const winner = before[w - 1];
      const loser = before[w - 1 - gap];
      const after = applyWin(before, winner, loser);
      const dropped = (after.indexOf(loser) + 1) - (before.indexOf(loser) + 1);
      assert.equal(dropped, 1, `loser moved ${dropped} at gap ${gap}`);
    }
  }
});

test('the ladder stays contiguous with nobody duplicated or lost', () => {
  const before = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
  const after = applyWin(before, 'p9', 'p6');
  assert.equal(after.length, before.length);
  assert.equal(new Set(after).size, before.length, 'no duplicates, nobody dropped');
});

test('a successful defence moves nobody', () => {
  const before = ['Dan', 'Jo', 'Kurt'];
  // The higher-placed player wins: cascade_ranking_after_win returns early.
  assert.deepEqual(applyWin(before, 'Dan', 'Kurt'), before);
});

// Carl, clarifying: "There's times where a loss doesn't change the list at all,
// and that's when a player lower on the list challenging a higher ranked player
// loses. Nothing changes in that situation. So a loss does not cost one spot to
// the person that's already lower than the person they lost their challenge to."
//
// This is the common outcome, and the one the earlier wording of this file got
// wrong by saying a loss "never costs less than one spot". It does, when the
// person losing is the challenger.
test('losing a challenge costs the challenger nothing, over every legal gap', () => {
  const before = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
  for (let gap = 1; gap <= 5; gap += 1) {
    for (let c = gap + 1; c <= before.length; c += 1) {
      const challenger = before[c - 1];
      const defender = before[c - 1 - gap];
      // The defender wins, so the defender is the winner passed to the function.
      const after = applyWin(before, defender, challenger);
      assert.deepEqual(after, before, `gap ${gap} from #${c} moved somebody`);
      assert.equal(after.indexOf(challenger), before.indexOf(challenger),
        'the challenger did not fall for trying');
      assert.equal(after.indexOf(defender), before.indexOf(defender),
        'the defender did not climb for holding');
    }
  }
});

test('the migration spells out that a failed challenge moves nobody', () => {
  assert.match(rotation, /Losing a challenge never costs a spot/);
});

test('the rules text tells a player a failed challenge costs them nothing', () => {
  const rules = readFileSync(join(root, 'src', 'config', 'league.ts'), 'utf8');
  assert.match(rules, /Losing a challenge never costs you a spot/);
  assert.match(rules, /the list does not change at all/);
});

// ── and that the SQL actually implements the model above ────────────────────

test('the migration rotates rather than swapping', () => {
  // The winner lands on the loser's spot...
  assert.match(rotation, /SET position = v_loser_pos/);
  // ...and the block the winner passed comes back one lower. -999 off a +1000
  // park is the one-spot drop; -1000 would be a no-op and -1001 would be a
  // one-spot climb, so this constant is the rule.
  assert.match(rotation, /position = position - 999/);
});

test('the migration still refuses to move anything when the defender won', () => {
  assert.match(rotation, /v_winner_pos <= v_loser_pos[\s\S]*?RETURN;/);
});

test('the migration parks the block before landing anyone back in it', () => {
  // rankings.position is UNIQUE and not deferrable, so this ordering is load
  // bearing, not style.
  assert.match(rotation, /position\s*=\s*position \+ 1000/);
  assert.match(rotation, /LOCK TABLE public\.rankings IN SHARE ROW EXCLUSIVE MODE/);
});

test('the rules text says which way up the list is', () => {
  const rules = readFileSync(join(root, 'src', 'config', 'league.ts'), 'utf8');
  assert.match(rules, /Up the list means towards #1, and a smaller number/);
  assert.match(rules, /Nobody ever falls more than one spot from a single result/);
});

// ── the reversal must refuse what it can no longer undo ─────────────────────
//
// Found by the migration review, then confirmed on live data. The rotation
// changes the shape of the forfeit events reverse_challenge_decline_forfeit has
// to invert, and the function could not tell the old shape from the new one:
//
//   swap era, any gap   -> forfeiting_new_position = challenger_previous_position
//   rotation era, any   -> forfeiting_new_position = forfeiting_previous_position + 1
//
// Those coincide at a gap of one and diverge above it. The old fast path keyed
// on the swap pattern, so a swap-era gap-2 event would have been undone as if it
// were a rotation -- the challenger dropping one spot instead of returning to
// their own, and an untouched player in between pulled down a spot they never
// lost. Seven such events existed live; six were already refused because the
// positions had drifted, one was still exactly on its recorded positions.

const reversalGuard = migrationMatching('reversal_refuses_what_it_cannot_undo');

function recordedShapeIsRotation({ chPrev, foPrev, foNew }) {
  void chPrev;
  return foNew === foPrev + 1;
}

test('a rotation-era forfeit is recognised as invertible at every gap', () => {
  for (let gap = 1; gap <= 5; gap += 1) {
    const foPrev = 40;
    const chPrev = foPrev + gap;
    // The rotation always leaves the loser exactly one below where they were.
    assert.ok(recordedShapeIsRotation({ chPrev, foPrev, foNew: foPrev + 1 }),
      `gap ${gap} should be invertible`);
  }
});

test('a swap-era forfeit over a gap above one is recognised as NOT invertible', () => {
  for (let gap = 2; gap <= 5; gap += 1) {
    const foPrev = 40;
    const chPrev = foPrev + gap;
    // The swap put the loser where the challenger had been.
    assert.equal(recordedShapeIsRotation({ chPrev, foPrev, foNew: chPrev }), false,
      `swap-era gap ${gap} must be refused`);
  }
});

test('a swap-era forfeit over a gap of one is still invertible -- the shapes agree', () => {
  const foPrev = 40;
  const chPrev = 41;
  assert.ok(recordedShapeIsRotation({ chPrev, foPrev, foNew: chPrev }),
    'at gap 1 a swap and a rotation record the same thing');
});

test('the migration refuses rather than guessing', () => {
  assert.match(reversalGuard, /forfeiting_new_position IS DISTINCT FROM v_event\.forfeiting_previous_position \+ 1/);
  assert.match(reversalGuard, /recorded before the ladder rule changed/);
});

test('the migration leaves exactly one route through the ranking restore', () => {
  // The fast path is gone; the block shift inverts a rotation at every gap.
  assert.equal(reversalGuard.includes('PERFORM public.cascade_ranking_after_win'), false,
    'the fast path must not survive -- it cannot tell a swap from a rotation');
  assert.match(reversalGuard, /position = position - 1001/);
});
