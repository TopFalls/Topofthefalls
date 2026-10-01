import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Testing period: league_settings.automatic_list_changes decides whether the
// app moves the list by itself. Ships OFF. ON must be exactly the old behaviour
// and OFF must never change a ranking, a record or a cooldown. The written
// rules are deliberately left alone because the strict rules are expected back.

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const noComments = (text) => text.replace(/^\s*(--|\/\/).*$/gm, '');

const migration = read('supabase/migrations/20261001120000_automatic_list_changes_switch.sql');
const respond = read('supabase/functions/respond-to-challenge/index.ts');

const LIST_CHANGERS = /cascade_ranking_after_win|drop_player_spots|admin_reorder|apply_challenge_decline_forfeit|UPDATE public\.rankings|UPDATE public\.player_season_stats|UPDATE public\.player_discipline_stats|cooldown/i;

function fnBody(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  return noComments(migration.slice(start, migration.indexOf('COMMENT ON FUNCTION', start)));
}

test('the switch ships OFF and is a real column', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS automatic_list_changes boolean NOT NULL DEFAULT false/);
  assert.match(migration, /UPDATE public\.league_settings SET automatic_list_changes = true;/);
});

test('the existing cron jobs are left alone; the functions read the switch', () => {
  assert.doesNotMatch(noComments(migration), /cron\.unschedule|cron\.schedule/);
  assert.match(fnBody('expire_stale_challenges'), /automatic_list_changes/);
  assert.match(fnBody('apply_inactive_drift'), /automatic_list_changes/);
});

test('overdue challenges: ON forfeits as before, OFF only raises one admin alert', () => {
  const body = fnBody('expire_stale_challenges');
  const split = body.indexOf('END IF;');
  const on = body.slice(0, split);
  const off = body.slice(split);
  assert.match(on, /apply_challenge_decline_forfeit/);
  assert.match(off, /INSERT INTO public\.admin_alerts/);
  assert.match(off, /NOT EXISTS/, 'one alert per challenge and deadline');
  assert.doesNotMatch(off, LIST_CHANGERS);
  assert.doesNotMatch(off, /\bUPDATE\s+public\.|\bDELETE\s+FROM/i);
});

test('inactive players: ON drops as before, OFF moves nobody', () => {
  const body = fnBody('apply_inactive_drift');
  const elseAt = body.indexOf('ELSE');
  const endAt = body.indexOf('END IF;', elseAt);
  assert.ok(elseAt > 0 && endAt > elseAt, 'ON/OFF branches located');
  assert.match(body.slice(0, elseAt), /drop_player_spots/);
  const off = body.slice(elseAt, endAt);
  assert.doesNotMatch(off, /drop_player_spots|cascade_ranking_after_win|UPDATE public\.rankings/i);
  assert.match(off, /Nobody has been moved/);
  assert.match(body, /v_days >= 90/, 'the 90-day review alert survives in both modes');
});

test('declining: an unreadable setting can never move the list', () => {
  assert.match(respond, /automaticListChanges = settingsRow\?\.automatic_list_changes === true/);
  const a = respond.indexOf("action === 'decline'");
  const b = respond.indexOf("action === 'reverse_decline'");
  const branch = noComments(respond.slice(a, b));
  assert.match(branch, /challenge\.challenged_id !== callerPlayer\.id/, 'only the challenged player may decline');
  const on = branch.indexOf('if (automaticListChanges) {');
  const off = branch.indexOf('} else {', on);
  assert.ok(on >= 0 && off > on, 'ON/OFF paths located');
  assert.match(branch.slice(on, off), /apply_challenge_decline_forfeit/);
  const plain = branch.slice(off);
  assert.doesNotMatch(plain, LIST_CHANGERS);
  assert.match(plain, /status: 'declined'/);
  assert.match(plain, /\.eq\('status', 'pending'\)/, 'a double tap cannot decline twice');
  assert.match(plain, /from\('admin_alerts'\)/, 'the admin is told and decides');
});

test('create-challenge still runs the (now switch-aware) sweep', () => {
  assert.match(read('supabase/functions/create-challenge/index.ts'), /rpc\('expire_stale_challenges'\)/);
});

test('screens only stop promising a forfeit when the setting is known to be off', () => {
  assert.match(read('src/hooks/useAutomaticListChanges.ts'), /return data !== false;/);
  const copy = read('src/components/DeclineConsequences.tsx');
  assert.match(copy, /Decline counts as a forfeit/);
  assert.match(copy, /Neither player's spot on the list changes/);
  for (const page of ['src/pages/ChallengesPage.tsx', 'src/pages/NotificationsPage.tsx']) {
    const src = read(page);
    assert.match(src, /<DeclineConsequences automatic=\{automatic\}/, page);
    assert.doesNotMatch(src, /Decline counts as a forfeit/, `${page} takes its wording from the switch`);
  }
});

test('the written rules are untouched: the strict rules are expected to return', () => {
  const rules = read('src/config/league.ts');
  assert.match(rules, /The challenged player must respond within 48 hours of the callout\./);
  assert.match(rules, /If the challenged player declines or cannot play, the challenger gets the spot\./);
  assert.match(rules, /Inactive more than 30 days drops you two spots for every 30 days inactive\./);
});
