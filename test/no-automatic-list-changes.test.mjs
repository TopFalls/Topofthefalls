import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Admins have full manual control of the list. No deadline, decline or
// inactivity period may move a ranking, a record or a cooldown by itself.

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const migration = read('supabase/migrations/20261001120000_no_automatic_list_changes.sql');
const respond = read('supabase/functions/respond-to-challenge/index.ts');
const create = read('supabase/functions/create-challenge/index.ts');

const noComments = (text) => text.replace(/^\s*(--|\/\/).*$/gm, '');

/** The text of one SQL function body, from its CREATE to its COMMENT/REVOKE. */
function fnBody(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} is defined in the migration`);
  const end = migration.indexOf('COMMENT ON FUNCTION', start);
  return noComments(migration.slice(start, end));
}

/** The decline branch of respond-to-challenge. */
const declineBranch = (() => {
  const a = respond.indexOf("action === 'decline'");
  const b = respond.indexOf("action === 'reverse_decline'");
  assert.ok(a >= 0 && b > a, 'decline branch located');
  return noComments(respond.slice(a, b));
})();

const LIST_CHANGERS = /cascade_ranking_after_win|drop_player_spots|admin_reorder|UPDATE public\.rankings|UPDATE public\.player_season_stats|UPDATE public\.player_discipline_stats|cooldown/i;

test('the hourly auto-forfeit job is unscheduled and the old sweep does nothing', () => {
  assert.match(migration, /cron\.unschedule\('tof-expire-challenges'\)/);
  const sweep = fnBody('expire_stale_challenges');
  assert.match(sweep, /SELECT 0;/);
  assert.doesNotMatch(sweep, /apply_challenge_decline_forfeit|forfeited|\bUPDATE\s+public\./i);
});

test('overdue challenges only raise one admin alert and change nothing', () => {
  const flag = fnBody('flag_overdue_challenges');
  assert.match(flag, /INSERT INTO public\.admin_alerts/);
  assert.match(flag, /NOT EXISTS/, 'one alert per challenge and deadline');
  assert.doesNotMatch(flag, /\bUPDATE\s+public\.|\bDELETE\s+FROM/i);
  assert.doesNotMatch(flag, LIST_CHANGERS);
  assert.match(migration, /cron\.schedule\(\s*\n?\s*'tof-flag-overdue-challenges'/);
});

test('inactive players only raise admin alerts; nobody is moved', () => {
  const drift = fnBody('apply_inactive_drift');
  assert.match(drift, /INSERT INTO public\.admin_alerts/);
  assert.match(drift, /Nobody has been moved/);
  assert.doesNotMatch(drift, LIST_CHANGERS);
  assert.doesNotMatch(drift, /UPDATE public\.rankings/i);
});

test('declining records a plain decline: no forfeit, no list change, no cooldown', () => {
  assert.doesNotMatch(declineBranch, /apply_challenge_decline_forfeit/);
  assert.doesNotMatch(declineBranch, LIST_CHANGERS);
  assert.match(declineBranch, /status: 'declined'/);
  // The conditional update is what stops a double tap from declining twice.
  assert.match(declineBranch, /\.eq\('status', 'pending'\)/);
  assert.match(declineBranch, /from\('admin_alerts'\)/, 'the admin is told and decides');
});

test('only the challenged player may decline', () => {
  assert.match(declineBranch, /challenge\.challenged_id !== callerPlayer\.id/);
});

test('create-challenge no longer sweeps expired challenges', () => {
  assert.doesNotMatch(create, /rpc\('expire_stale_challenges'\)/);
});

test('the decline prompts no longer promise a forfeit', () => {
  // The written rules in src/config/league.ts are deliberately NOT asserted
  // here: they keep describing the strict rules because this is a temporary
  // testing period and the automatic behaviour is expected to return.
  for (const page of ['src/pages/ChallengesPage.tsx', 'src/pages/NotificationsPage.tsx']) {
    const src = read(page);
    assert.doesNotMatch(src, /Decline counts as a forfeit/i, page);
    assert.doesNotMatch(src, /Decline \(forfeit\)/i, page);
  }
});
