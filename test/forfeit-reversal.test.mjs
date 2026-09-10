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

const reversalFix = migrationMatching('reversed_forfeit_gets_a_real_window');
// The live sweep is the one that turns an expired challenge into a forfeit --
// 20260814122000 -- not the earlier 20260507040125 that only marked it expired.
// Only the forfeiting version moves the ladder, which is what made the loop bite.
const sweepMigration = migrationMatching('expiry_counts_as_forfeit');

// The ladder loop this pins, in one paragraph, because the cost of forgetting it
// was three days of a live league's rankings being wrong.
//
// expire_stale_challenges() forfeits every challenge that is pending with
// expires_at in the past, and a forfeit swaps the challenger up the ladder. The
// reversal used to restore status='pending' and leave expires_at untouched --
// necessarily in the past, since expiring is how the challenge got forfeited at
// all. That is the sweep's exact predicate, so the next hourly run forfeited it
// again. Apply, reverse, apply, and the ladder moved every pass.

test('the sweep still fires on pending challenges whose window has passed', () => {
  // If this predicate ever changes, the reasoning below has to be rechecked.
  assert.match(sweepMigration, /status\s*=\s*'pending'/);
  assert.match(sweepMigration, /expires_at\s*<=\s*now\(\)/);
});

test('reversing a forfeit refreshes a window that has already lapsed', () => {
  assert.match(
    reversalFix,
    /UPDATE public\.challenges[\s\S]*?expires_at = CASE[\s\S]*?WHEN expires_at <= now\(\)[\s\S]*?make_interval\(hours =>/,
    'the challenge restore must give a lapsed challenge a fresh response window',
  );
});

test('a challenge still inside its window keeps its original deadline', () => {
  // Refreshing unconditionally would hand a live challenge a second full window
  // every time an admin touched it.
  assert.match(reversalFix, /ELSE expires_at\s*\n\s*END,/);
});

test('the refreshed window comes from league_settings, not a hard-coded number', () => {
  assert.match(reversalFix, /SELECT ls\.challenge_response_hours FROM public\.league_settings ls LIMIT 1/);
});

test('the reversal still restores the status the forfeit event recorded', () => {
  // The fix adds to this statement; it must not have replaced what it did.
  assert.match(reversalFix, /SET status = v_event\.previous_challenge_status/);
  assert.match(reversalFix, /response_message = v_event\.metadata->>'previous_response_message'/);
});
