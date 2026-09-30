import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260930130000_follow_players_and_push_devices.sql');

// Who follows whom, and which phones are registered, are private to the account.

for (const table of ['player_follows', 'push_devices']) {
  test(`${table} is row-secured and closed to guests`, () => {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`REVOKE ALL ON public\\.${table} FROM anon, authenticated`));
    assert.doesNotMatch(migration, new RegExp(`GRANT[^;]*public\\.${table}[^;]*TO[^;]*\\banon\\b`, 'is'));
  });
}

test('every follow and device policy is limited to the caller\'s own account', () => {
  const policies = migration.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
  assert.ok(policies.length >= 4);
  for (const p of policies) {
    assert.match(p, /profile_id = auth\.uid\(\)/, p);
    assert.match(p, /TO authenticated/, p);
  }
});

test('notifications no longer share one tag, so a new one does not replace the last', () => {
  const sw = read('public/sw.js');
  assert.doesNotMatch(sw, /tag:\s*'totf'/);
  assert.doesNotMatch(sw, /renotify/);
});

test('followers are told about a confirmed result, minus the two players in it', () => {
  const fn = read('supabase/functions/submit-result/index.ts');
  assert.match(fn, /notifyFollowers\(supabase, \[winnerId, loserId\][^\n]*\[winnerId, loserId\]\)/);
});

test('every function sends push through the shared sender that reads both device tables', () => {
  for (const name of ['submit-result', 'create-challenge']) {
    const fn = read(`supabase/functions/${name}/index.ts`);
    assert.match(fn, /from '\.\.\/_shared\/sendPush\.ts'/);
    assert.doesNotMatch(fn, /from\('push_subscriptions'\)/, `${name} must not carry its own copy`);
  }
  const shared = read('supabase/functions/_shared/sendPush.ts');
  assert.match(shared, /push_devices/);
  assert.match(shared, /push_subscriptions/);
});
