import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { canChallenge } from '../src/lib/ladder.ts';

// Carl's written Top of the Falls rules, pinned to the code that implements
// them. The rank-1 obligation, the cooldowns and the response window had all
// drifted from this document; these tests exist so they cannot drift back.

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const migrationDir = 'supabase/migrations';
const migrationNames = readdirSync(join(root, migrationDir));
const readMigration = (fragment) => {
  const name = migrationNames.find((file) => file.includes(fragment));
  assert.ok(name, `expected a migration matching "${fragment}"`);
  return read(join(migrationDir, name));
};

const alignment = readMigration('align_rules_with_league_document');
const createChallenge = read('supabase/functions/create-challenge/index.ts');
const submitResult = read('supabase/functions/submit-result/index.ts');
const respondToChallenge = read('supabase/functions/respond-to-challenge/index.ts');
const addPlayer = read('supabase/functions/add-player/index.ts');
const rank1Compliance = read('supabase/functions/rank1-compliance/index.ts');
const settingsTab = read('src/components/admin/SettingsTab.tsx');

// --- Rule 2, 3, 3b: the challenge window ----------------------------------

test('rule 2 — inside the top 11 you may challenge one spot up only', () => {
  assert.equal(canChallenge(2, 1), true);
  assert.equal(canChallenge(11, 10), true);
  assert.equal(canChallenge(11, 9), false);
  assert.equal(canChallenge(5, 3), false);
});

test('rule 3 — from the 12th spot down you may challenge up two spots', () => {
  assert.equal(canChallenge(12, 11), true);
  assert.equal(canChallenge(12, 10), true);
  assert.equal(canChallenge(21, 20), true);
  assert.equal(canChallenge(21, 19), true);
  assert.equal(canChallenge(21, 18), false);
});

test('rule 3b — only #11 and #12 can reach #10', () => {
  assert.equal(canChallenge(11, 10), true);
  assert.equal(canChallenge(12, 10), true);
  for (const from of [13, 14, 15]) {
    assert.equal(canChallenge(from, 10), false, `#${from} must not reach #10`);
  }
});

test('challenges only ever go upward', () => {
  assert.equal(canChallenge(1, 2), false);
  assert.equal(canChallenge(3, 7), false);
});

// --- No rank-1 obligation --------------------------------------------------

test('the rules contain no rank-1 obligation, so no code enforces one', () => {
  // A previous version let #1 challenge #2-#5 "to satisfy the rank-1
  // obligation" and, 30 days after anyone took the top spot, publicly
  // announced a demotion that apply_rank1_penalty never actually applied.
  for (const theirPos of [2, 3, 4, 5]) {
    assert.equal(canChallenge(1, theirPos), false, `#1 must not be able to challenge #${theirPos}`);
  }
  // Call sites, not the word — the comments explaining the removal name it.
  assert.doesNotMatch(createChallenge, /if \(myPos === 1\)/);
  assert.doesNotMatch(createChallenge, /#2 through #5/);
  assert.doesNotMatch(submitResult, /await checkRank1Compliance/);
  assert.doesNotMatch(submitResult, /rpc\('apply_rank1_penalty'/);
  assert.doesNotMatch(submitResult, /event_type: 'rank1_penalty'/);
  assert.doesNotMatch(rank1Compliance, /rpc\('apply_rank1_penalty'/);
});

test('nothing writes rankings.rank1_since any more', () => {
  // The clock used to start by itself the moment anyone won the #1 spot.
  for (const [name, source] of Object.entries({ submitResult, addPlayer, rank1Compliance })) {
    assert.doesNotMatch(
      source,
      /rank1_since:\s*(new Date|\w+\?)/,
      `${name} must not stamp rank1_since`,
    );
  }
  assert.doesNotMatch(alignment, /rank1_since = now\(\)/);
  assert.doesNotMatch(alignment, /rank1_since = CASE/);
  // The retired endpoint answers instead of enforcing.
  assert.match(rank1Compliance, /410/);
});

// --- Rule 5: cooldowns -----------------------------------------------------

test('rule 5 — cooldowns follow win-from-below and loss, not just loss', () => {
  // 5a defend -> nothing, 5b win from below -> 24h, 5c lose -> 7 days.
  assert.match(submitResult, /applyPostMatchCooldowns/);
  assert.match(submitResult, /loss_cooldown_hours/);
  assert.match(submitResult, /winnerMovedUp && winHours > 0/);
  assert.match(submitResult, /lossHours > 0.*loserId/s);
  // A defender who holds their spot never gets one.
  assert.match(submitResult, /let winnerMovedUp = false/);
  assert.doesNotMatch(submitResult, /createPostLossCooldown/);
});

test('rule 5 defaults match the document: 24 hours up, 7 days after a loss', () => {
  assert.match(alignment, /loss_cooldown_hours integer NOT NULL DEFAULT 168/);
  assert.match(submitResult, /cooldown_hours \?\? 24/);
  assert.match(submitResult, /loss_cooldown_hours \?\? 168/);
});

test('rule 5b covers forfeits — declining costs the challenger a cooldown too', () => {
  // "this includes forfeits". The reversal has to clear both, or an undone
  // decline leaves the challenger sitting out for a forfeit that never was.
  assert.match(alignment, /challenger_cooldown_id/);
  assert.match(alignment, /DELETE FROM public\.cooldowns WHERE id = v_challenger_cooldown_id/);
});

// --- Rules 3, 3a.I, 3b.II, 4, c.I: windows and limits ----------------------

test('rule 3 — 48 hours to respond, read from league settings', () => {
  assert.match(createChallenge, /challenge_response_hours/);
  assert.match(createChallenge, /responseHours \* 3600 \* 1000/);
  assert.match(alignment, /challenge_response_hours integer NOT NULL DEFAULT 48/);
});

test('rule 3a.I — 10 days to play, read from league settings', () => {
  assert.match(respondToChallenge, /match_play_days/);
  assert.match(alignment, /match_play_days integer NOT NULL DEFAULT 10/);
});

test('rule 3b.II — two challenges per week', () => {
  assert.match(createChallenge, /challenge_weekly_limit/);
  assert.match(alignment, /challenge_weekly_limit integer NOT NULL DEFAULT 2/);
});

test('rule 4 — Saratoga stays keyed to the visible top 20', () => {
  // Not active rank: this is a league eligibility rule, not a challenge window.
  assert.match(createChallenge, /myPos > 20 \|\| theirPos > 20/);
});

test('rule c.I — race to six minimum, no maximum', () => {
  assert.match(createChallenge, /min_race \?\? 6/);
  assert.match(createChallenge, /Number\.isInteger\(maxRace\) && race_length > maxRace/);
});

// --- Admin surface ---------------------------------------------------------

test('the settings screen shows no knob that does nothing', () => {
  // first_challenge_range was never read by any code; challenge_expiry_days is
  // superseded by challenge_response_hours. Checked as rendered fields and
  // submitted values, not as words — both are named in the file's comments.
  for (const dead of ['first_challenge_range', 'challenge_expiry_days']) {
    assert.doesNotMatch(settingsTab, new RegExp(`key: '${dead}'`), `${dead} must not be a rendered field`);
    assert.doesNotMatch(settingsTab, new RegExp(`\\n\\s+${dead}: edits\\.`), `${dead} must not be submitted`);
  }
  assert.match(settingsTab, /key: 'loss_cooldown_hours'/);
});

test('every settings field the admin form submits exists in the schema', () => {
  // The form previously named three columns that did not exist, so saving any
  // league rule failed outright.
  const formKeys = [...settingsTab.matchAll(/^\s{4}(\w+): edits\./gm)].map((m) => m[1]);
  assert.ok(formKeys.length >= 7, `expected the settings form to submit fields, got ${formKeys.length}`);
  const schema = read('src/types/database.ts');
  for (const key of formKeys) {
    assert.match(schema, new RegExp(`\\b${key}: number`), `${key} must exist on league_settings`);
  }
});
