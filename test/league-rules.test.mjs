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
const setPlayerActive = read('supabase/functions/set-player-active/index.ts');
const challengesPage = read('src/pages/ChallengesPage.tsx');
const challengesTab = read('src/components/admin/ChallengesTab.tsx');

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

// --- Inactive players ------------------------------------------------------

test('inactive drift: two spots per 30 days, automatic, and Carl is told', () => {
  const m = readMigration('inactive_lifecycle_and_wash');
  assert.match(m, /v_periods := floor\(v_days \/ 30\.0\)/);
  assert.match(m, /drop_player_spots\(v_row\.id, v_due \* 2\)/);
  // Idempotent: a delayed or repeated run must not drop anyone twice.
  assert.match(m, /v_due := v_periods - COALESCE\(v_row\.inactive_drift_periods, 0\)/);
  assert.match(m, /alert_type.*inactive_drift|'inactive_drift'/s);
  // It has to run without anyone remembering to.
  assert.match(m, /cron\.schedule\('tof-inactive-drift'/);
});

test('90 days raises a review for Carl, once, and clears if they come back', () => {
  const m = readMigration('inactive_lifecycle_and_wash');
  assert.match(m, /v_days >= 90/);
  assert.match(m, /alert_type = 'inactive_90_day' AND acknowledged_at IS NULL/);
  // Returning acknowledges the open review rather than leaving it hanging.
  assert.match(m, /UPDATE public\.admin_alerts SET acknowledged_at = now\(\)\s*\n\s*WHERE player_id = p_player_id AND alert_type = 'inactive_90_day'/);
});

test('returning: defend or wait 7 days, 24 hours if last on the list', () => {
  const m = readMigration('inactive_lifecycle_and_wash');
  assert.match(m, /v_hours := CASE WHEN v_pos IS NOT NULL AND v_pos = v_last THEN 24 ELSE 168 END/);
  assert.match(m, /'reentry', now\(\) \+ make_interval\(hours => v_hours\)/);
  // Defending ends the wait — win or lose. player2 is the challenged side.
  assert.match(submitResult, /\.eq\('player_id', match\.player2_id\)\s*\n\s*\.eq\('type', 'reentry'\)/);
});

test('every cooldown blocks challenging and none block defending', () => {
  // create-challenge is the only place a cooldown is checked, and it no longer
  // looks at post_match alone.
  assert.doesNotMatch(createChallenge, /\.eq\('type', 'post_match'\)/);
  assert.match(createChallenge, /myCooldown\.type === 'reentry'/);
  assert.match(createChallenge, /myCooldown\.type === 'wash'/);
  assert.doesNotMatch(respondToChallenge, /from\('cooldowns'\)/);
});

test('players can go inactive themselves, and the admin path uses the same rules', () => {
  const m = readMigration('inactive_lifecycle_and_wash');
  assert.match(m, /FUNCTION public\.set_own_active\(boolean\)/);
  assert.match(m, /GRANT EXECUTE ON FUNCTION public\.set_own_active\(boolean\) TO authenticated/);
  // Setting players.is_active directly would skip the drift clock and the wait.
  assert.match(setPlayerActive, /rpc\('set_player_active_state'/);
  assert.doesNotMatch(setPlayerActive, /\.update\(\{ is_active: body\.is_active \}\)/);
});

// --- Rule 4: the wash ------------------------------------------------------

test('a wash is raised by either player and decided by Carl', () => {
  const m = readMigration('inactive_lifecycle_and_wash');
  assert.match(m, /request_wash: you are not in this challenge/);
  assert.match(m, /admin_resolve_wash: admin role required/);
  // Nobody moves; the challenger sits, the challenged player is free.
  assert.match(m, /'wash', now\(\) \+ make_interval\(hours => v_hours\)/);
  assert.doesNotMatch(m, /cascade_ranking_after_win/);
  assert.match(challengesPage, /rpc\('request_wash'/);
  assert.match(challengesTab, /admin_resolve_wash/);
});

test('rule c.I — an agreed race longer than 15 is no longer rejected', () => {
  // "no maximum if it is agreed upon" — the tables used to cap it at 15.
  const m = readMigration('inactive_lifecycle_and_wash');
  assert.match(m, /challenges_race_length_check CHECK \(race_length >= 1\)/);
  assert.match(m, /matches_race_length_check CHECK \(race_length >= 1\)/);
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
