import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Push notifications that reach people with the app closed. The behaviour of the
// SQL is proven by test/push-dispatch.local.mjs (needs a scratch database); this
// file guards the wiring that a text check can see.

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const noComments = (text) => text.replace(/^\s*(--|\/\/).*$/gm, '');

const migration = read('supabase/migrations/20261001130000_push_dispatch_and_deadline_reminders.sql');
const dispatcher = read('supabase/functions/dispatch-push/index.ts');
const sender = read('supabase/functions/_shared/sendPush.ts');
const sw = read('public/sw.js');
const config = read('supabase/config.toml');

test('the dispatcher proves its caller before it claims or sends anything', () => {
  const code = noComments(dispatcher);
  const check = code.indexOf("rpc('check_push_dispatch_secret'");
  const unauthorized = code.indexOf("'Unauthorized'");
  const claimNotes = code.indexOf("rpc('claim_unpushed_notifications'");
  const claimAlerts = code.indexOf("rpc('claim_unpushed_admin_alerts'");
  assert.ok(check > 0 && unauthorized > check, 'the secret is checked and refused');
  assert.ok(claimNotes > unauthorized && claimAlerts > unauthorized, 'nothing is claimed before the check');
  assert.match(code, /x-dispatch-secret/);
  assert.match(code, /req\.method !== 'POST'/);
});

test('the dispatcher is declared public on purpose, with the reason, in both places', () => {
  assert.match(dispatcher, /^\/\/ tof-guard: public/m);
  assert.match(config, /\[functions\.dispatch-push\]\s*\nverify_jwt = false/);
});

test('the secret is made by the database and only service_role can use it', () => {
  assert.match(migration, /vault\.create_secret\(/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.check_push_dispatch_secret\(text\) FROM PUBLIC, anon, authenticated;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.check_push_dispatch_secret\(text\) TO service_role;/);
  assert.doesNotMatch(dispatcher, /VITE_/);
});

test('the claim functions and the cron check share one allowlist', () => {
  const body = noComments(migration);
  const uses = body.match(/public\.push_dispatched_types\(\)/g) ?? [];
  assert.ok(uses.length >= 3, 'defined once, used by the claim function and the cron check');
  assert.match(body, /x\.type = ANY \(public\.push_dispatched_types\(\)\)/);
  assert.match(body, /pushed_at IS NULL AND type = ANY \(public\.push_dispatched_types\(\)\)/);
});

test('types that edge functions already push themselves are never dispatched (no double push)', () => {
  const list = migration.slice(migration.indexOf('SELECT ARRAY['), migration.indexOf('];', migration.indexOf('SELECT ARRAY[')));
  for (const t of ['challenge_received', 'challenge_accepted', 'challenge_declined', 'result_submitted', 'result_confirmed',
    'challenge_forfeited', 'challenge_forfeit_win', 'challenge_forfeit_reversed']) {
    assert.doesNotMatch(list, new RegExp(`'${t}'`), `${t} is pushed by its own edge function`);
  }
});

test('history is marked as pushed before the dispatcher exists', () => {
  const backfill = migration.indexOf('UPDATE public.notifications SET pushed_at = now() WHERE pushed_at IS NULL;');
  const schedule = migration.indexOf("cron.schedule(\n  'tof-dispatch-push'");
  assert.ok(backfill > 0 && schedule > backfill);
  assert.match(migration, /UPDATE public\.admin_alerts\s+SET pushed_at = now\(\) WHERE pushed_at IS NULL;/);
});

test('reminders never touch the list', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.send_deadline_reminders()');
  const body = noComments(migration.slice(start, migration.indexOf('COMMENT ON FUNCTION public.send_deadline_reminders()')));
  assert.doesNotMatch(body, /\bUPDATE\s+public\./i);
  assert.doesNotMatch(body, /\bDELETE\s+FROM/i);
  assert.doesNotMatch(body, /cascade_ranking_after_win|drop_player_spots|apply_challenge_decline_forfeit|rankings/i);
});

test('the sender removes dead subscriptions and supports per-notification tags', () => {
  assert.match(sender, /status === 404 \|\| status === 410/);
  assert.match(sender, /\.delete\(\)\.eq\('player_id', playerId\)/);
  assert.match(sender, /JSON\.stringify\(\{ title, body, url, tag \}\)/);
  assert.match(sw, /tag: data\.tag \?\? 'totf'/, 'pushes without a tag keep the old shared tag');
});

test('every dispatched notification type has an icon, and the admin link exists', () => {
  const page = read('src/pages/NotificationsPage.tsx');
  const list = migration.slice(migration.indexOf('SELECT ARRAY['), migration.indexOf('];', migration.indexOf('SELECT ARRAY[')));
  for (const [, type] of list.matchAll(/'([a-z0-9_]+)'/g)) {
    assert.match(page, new RegExp(`\\b${type}:`), `${type} needs an icon on the notifications page`);
  }
  assert.match(read('src/App.tsx'), /path="\/admin"/);
  assert.match(dispatcher, /'\/admin'/);
});

test('the schedules exist and the dispatcher only calls out when something is waiting', () => {
  assert.match(migration, /cron\.schedule\(\s*\n?\s*'tof-deadline-reminders', '20 \* \* \* \*'/);
  assert.match(migration, /cron\.schedule\(\s*\n?\s*'tof-dispatch-push', '\* \* \* \* \*'/);
  assert.match(migration, /WHERE EXISTS \(SELECT 1 FROM vault\.decrypted_secrets WHERE name = 'push_dispatch_secret'\)/);
});

test('the browser gets only the PUBLIC push key, in the right shape, and never a private one', () => {
  const config = read('src/config/push.ts');
  const key = /DEFAULT_VAPID_PUBLIC_KEY =\s*'([^']+)'/.exec(config)?.[1];
  assert.match(key ?? '', /^B[A-Za-z0-9_-]{86}$/, 'an uncompressed P-256 public key: 87 base64url characters starting with B');
  assert.match(config, /import\.meta\.env\.VITE_VAPID_PUBLIC_KEY/, 'a Vercel setting can still override it');
  assert.match(read('src/hooks/usePushNotifications.ts'), /from '\.\.\/config\/push'/);
  // A VAPID private key is 43 base64url characters; none may sit in the browser code.
  for (const file of ['src/config/push.ts', 'src/hooks/usePushNotifications.ts']) {
    assert.doesNotMatch(read(file), /VAPID_PRIVATE_KEY['"]?\s*[:=]\s*['"][A-Za-z0-9_-]{40,}/, file);
  }
});
