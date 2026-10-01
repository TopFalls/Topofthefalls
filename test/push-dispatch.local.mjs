// Optional integration test: isolated in-memory PostgreSQL, never production.
//
// Runs the real 20261001130000 migration (and the real cron job SQL it registers)
// against stub tables. Setup, from the repo root:
//   mkdir -p work/deadline-test && cd work/deadline-test && npm init -y && npm i @electric-sql/pglite
// Run:  node test/push-dispatch.local.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../work/deadline-test/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const q = async (sql) => (await db.query(sql)).rows;
const scalar = async (sql) => {
  const v = Object.values((await q(sql))[0])[0];
  return typeof v === 'bigint' ? Number(v) : v;
};
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const P1 = id(1), P2 = id(2), ADMIN_PLAYER = id(3), SUPER_PLAYER = id(4), PLAIN_PLAYER = id(5);
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`ok  ${name}`); };

const challenge = (n, status, expires, deadline = 'NULL', challenger = P1, challenged = P2) =>
  `INSERT INTO challenges VALUES ('${id(100 + n)}', '${challenger}', '${challenged}', '9 Ball', '${status}', ${expires}, ${deadline});`;
const typesFor = async (cid, player) => (await q(
  `SELECT type FROM notifications WHERE reference_id = '${cid}' AND player_id = '${player}' ORDER BY type`)).map((r) => r.type);

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
    CREATE TABLE profiles (id uuid PRIMARY KEY, role text NOT NULL);
    CREATE TABLE players (id uuid PRIMARY KEY, full_name text NOT NULL, profile_id uuid);
    CREATE FUNCTION public.is_league_admin() RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS
      'SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'', ''super_admin''))';
    CREATE TABLE league_settings (automatic_list_changes boolean NOT NULL DEFAULT false);
    INSERT INTO league_settings DEFAULT VALUES;
    CREATE TABLE challenges (id uuid PRIMARY KEY, challenger_id uuid, challenged_id uuid,
      discipline text, status text, expires_at timestamptz, match_deadline timestamptz);
    CREATE TABLE matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), challenge_id uuid,
      status text, completed_at timestamptz);
    CREATE TABLE notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL,
      type text NOT NULL, title text NOT NULL, body text NOT NULL, reference_id uuid, reference_type text,
      is_read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
    -- cron, vault and pg_net stand-ins (the real ones exist only on Supabase)
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobname text, schedule text, command text);
    CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE plpgsql AS
      $$ BEGIN DELETE FROM cron.job WHERE jobname = $1; RETURN true; END; $$;
    CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE plpgsql AS
      $$ BEGIN INSERT INTO cron.job VALUES ($1, $2, $3); RETURN 1; END; $$;
    CREATE SCHEMA vault;
    CREATE TABLE vault.secrets (name text, decrypted_secret text);
    CREATE VIEW vault.decrypted_secrets AS SELECT name, decrypted_secret FROM vault.secrets;
    CREATE FUNCTION vault.create_secret(s text, n text, d text DEFAULT NULL) RETURNS uuid
      LANGUAGE plpgsql AS $$ BEGIN INSERT INTO vault.secrets VALUES (n, s); RETURN gen_random_uuid(); END; $$;
    CREATE SCHEMA net;
    CREATE TABLE net.calls (url text, secret text, at timestamptz DEFAULT now());
    CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint
      LANGUAGE plpgsql AS $$ BEGIN INSERT INTO net.calls VALUES (url, headers->>'x-dispatch-secret'); RETURN 1; END; $$;
  `);
  // The real admin_alerts table, its RLS and the deadline-reminder additions.
  const baseline = readFileSync('supabase/migrations/20260810140000_inactive_lifecycle_and_wash.sql', 'utf8');
  await db.exec(baseline.slice(baseline.indexOf('CREATE TABLE IF NOT EXISTS public.admin_alerts'), baseline.indexOf('-- Every cooldown')));
  const reminders = readFileSync('supabase/migrations/20260912160000_admin_deadline_reminders.sql', 'utf8');
  await db.exec(reminders.slice(0, reminders.indexOf('CREATE OR REPLACE FUNCTION')));

  await db.exec(`
    INSERT INTO players VALUES ('${P1}', 'Player One', NULL), ('${P2}', 'Player Two', NULL),
      ('${ADMIN_PLAYER}', 'Admin Player', '${id(13)}'), ('${SUPER_PLAYER}', 'Super Player', '${id(14)}'),
      ('${PLAIN_PLAYER}', 'Plain Player', '${id(15)}');
  `);
  await db.exec(`
    INSERT INTO profiles VALUES ('${id(13)}', 'admin'), ('${id(14)}', 'super_admin'), ('${id(15)}', 'player');
    INSERT INTO notifications (player_id, type, title, body) VALUES ('${P1}', 'challenge_received', 'old', 'old'),
      ('${P1}', 'match_day_reminder', 'old', 'old');
    INSERT INTO admin_alerts (alert_type, headline) VALUES ('wash_requested', 'old alert');
  `);

  // Run the migration file itself. Only the pg_net CREATE EXTENSION is removed:
  // PGlite has no such extension, and net.http_post is stubbed above.
  const migration = readFileSync('supabase/migrations/20261001130000_push_dispatch_and_deadline_reminders.sql', 'utf8');
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_net;/);
  await db.exec(migration.replace('CREATE EXTENSION IF NOT EXISTS pg_net;', ''));

  await check('history is never pushed: existing rows are marked as already pushed', async () => {
    assert.equal(await scalar(`SELECT count(*) FROM notifications WHERE pushed_at IS NULL`), 0);
    assert.equal(await scalar(`SELECT count(*) FROM admin_alerts WHERE pushed_at IS NULL`), 0);
  });

  await check('a secret is created in the vault, long and random', async () => {
    const s = await scalar(`SELECT decrypted_secret FROM vault.secrets WHERE name = 'push_dispatch_secret'`);
    assert.match(s, /^[0-9a-f]{64}$/);
  });

  await check('the dispatcher secret check: right secret passes, everything else fails', async () => {
    const s = await scalar(`SELECT decrypted_secret FROM vault.secrets WHERE name = 'push_dispatch_secret'`);
    assert.equal(await scalar(`SELECT public.check_push_dispatch_secret('${s}')`), true);
    assert.equal(await scalar(`SELECT public.check_push_dispatch_secret('${s}x')`), false);
    assert.equal(await scalar(`SELECT public.check_push_dispatch_secret('')`), false);
    assert.equal(await scalar(`SELECT public.check_push_dispatch_secret(NULL)`), false);
  });

  await check('only service_role can run the dispatcher functions', async () => {
    for (const fn of ['check_push_dispatch_secret(text)', 'claim_unpushed_notifications(integer)',
      'claim_unpushed_admin_alerts(integer)', 'push_admin_player_ids()', 'send_deadline_reminders()', 'push_dispatched_types()']) {
      for (const role of ['anon', 'authenticated']) {
        assert.equal(await scalar(`SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`), false, `${role} must not run ${fn}`);
      }
      assert.equal(await scalar(`SELECT has_function_privilege('service_role', 'public.${fn}', 'EXECUTE')`), true, `service_role runs ${fn}`);
    }
  });

  await check('response reminders: one per 24h/6h window, none outside them', async () => {
    await db.exec([
      challenge(1, 'pending', "now() + interval '30 hours'"),   // too early
      challenge(2, 'pending', "now() + interval '24 hours'"),   // 24h window edge
      challenge(3, 'pending', "now() + interval '10 hours'"),   // 24h window
      challenge(4, 'pending', "now() + interval '6 hours'"),    // 6h window edge
      challenge(5, 'pending', "now() + interval '5 hours'"),    // 6h window, no 24h first
      challenge(6, 'accepted', "now() + interval '5 hours'"),   // not pending
      challenge(7, 'pending', "now() + interval '1 second'"),   // still inside
    ].join('\n'));
    await q(`SELECT public.send_deadline_reminders()`);
    assert.deepEqual(await typesFor(id(101), P2), []);
    assert.deepEqual(await typesFor(id(102), P2), ['challenge_response_due_24h']);
    assert.deepEqual(await typesFor(id(103), P2), ['challenge_response_due_24h']);
    assert.deepEqual(await typesFor(id(104), P2), ['challenge_response_due_6h']);
    assert.deepEqual(await typesFor(id(105), P2), ['challenge_response_due_6h']);
    assert.deepEqual(await typesFor(id(106), P2), []);
    assert.deepEqual(await typesFor(id(107), P2), ['challenge_response_due_6h']);
    assert.deepEqual(await typesFor(id(102), P1), [], 'the challenger is not reminded to answer');
    const body = await scalar(`SELECT body FROM notifications WHERE reference_id = '${id(103)}'`);
    assert.match(body, /Player One challenged you to 9 Ball\. Please accept or decline within about 24 hours\./);
  });

  await check('running it again sends nothing new; a later window adds exactly one more', async () => {
    const before = await scalar(`SELECT count(*) FROM notifications`);
    assert.equal(await scalar(`SELECT public.send_deadline_reminders()`), 0);
    assert.equal(await scalar(`SELECT count(*) FROM notifications`), before);
    await db.exec(`UPDATE challenges SET expires_at = now() + interval '4 hours' WHERE id = '${id(103)}'`);
    assert.equal(await scalar(`SELECT public.send_deadline_reminders()`), 1);
    assert.deepEqual(await typesFor(id(103), P2), ['challenge_response_due_24h', 'challenge_response_due_6h']);
  });

  await check('overdue answer: one notice while forfeits are off, none while they are on', async () => {
    await db.exec(challenge(8, 'pending', "now() - interval '1 hour'"));
    await q(`SELECT public.send_deadline_reminders()`);
    assert.deepEqual(await typesFor(id(108), P2), ['challenge_response_overdue']);
    await q(`SELECT public.send_deadline_reminders()`);
    assert.equal(await scalar(`SELECT count(*) FROM notifications WHERE reference_id = '${id(108)}'`), 1, 'only once');
    await db.exec(`UPDATE league_settings SET automatic_list_changes = true; ${challenge(9, 'pending', "now() - interval '1 hour'")}`);
    await q(`SELECT public.send_deadline_reminders()`);
    assert.deepEqual(await typesFor(id(109), P2), [], 'the sweep acts instead, so no overdue notice');
    await db.exec(`UPDATE league_settings SET automatic_list_changes = false`);
  });

  await check('match deadline: both players are reminded, finished matches are not', async () => {
    await db.exec([
      challenge(20, 'scheduled', "now() - interval '2 days'", "now() + interval '20 hours'"),
      challenge(21, 'scheduled', "now() - interval '2 days'", "now() + interval '3 hours'"),
      challenge(22, 'scheduled', "now() - interval '2 days'", "now() + interval '3 hours'"),
      challenge(23, 'cancelled', "now() - interval '2 days'", "now() + interval '3 hours'"),
      challenge(24, 'scheduled', "now() - interval '2 days'", "now() + interval '40 hours'"),
      `INSERT INTO matches (id, challenge_id, status) VALUES ('${id(220)}', '${id(120)}', 'scheduled');`,
      `INSERT INTO matches (id, challenge_id, status) VALUES ('${id(222)}', '${id(122)}', 'submitted');`,
    ].join('\n'));
    await q(`SELECT public.send_deadline_reminders()`);
    for (const player of [P1, P2]) {
      assert.deepEqual(await typesFor(id(220), player), ['match_deadline_24h'], 'uses the match for the link');
      assert.deepEqual(await typesFor(id(121), player), ['match_deadline_6h'], 'no match row: falls back to the challenge');
    }
    assert.equal(await scalar(`SELECT reference_type FROM notifications WHERE reference_id = '${id(220)}' LIMIT 1`), 'match');
    assert.equal(await scalar(`SELECT reference_type FROM notifications WHERE reference_id = '${id(121)}' LIMIT 1`), 'challenge');
    assert.deepEqual(await typesFor(id(222), P1), [], 'a submitted match needs no reminder');
    assert.deepEqual(await typesFor(id(123), P1), [], 'a cancelled challenge needs no reminder');
    assert.deepEqual(await typesFor(id(124), P1), [], 'too early');
    const body = await scalar(`SELECT body FROM notifications WHERE reference_id = '${id(220)}' AND player_id = '${P1}'`);
    assert.match(body, /Your 9 Ball match with Player Two needs to be played within about 24 hours\./);
    assert.equal(await scalar(`SELECT public.send_deadline_reminders()`), 0, 'idempotent');
  });

  await check('a match past its play-by date raises one admin alert and changes nothing else', async () => {
    await db.exec(challenge(30, 'scheduled', "now() - interval '10 days'", "now() - interval '1 hour'"));
    const before = await q(`SELECT status FROM challenges WHERE id = '${id(130)}'`);
    await q(`SELECT public.send_deadline_reminders()`);
    await q(`SELECT public.send_deadline_reminders()`);
    assert.equal(await scalar(`SELECT count(*) FROM admin_alerts WHERE challenge_id = '${id(130)}' AND alert_type = 'challenge_play_overdue'`), 1);
    assert.match(await scalar(`SELECT detail FROM admin_alerts WHERE challenge_id = '${id(130)}'`), /Update the list if necessary\./);
    assert.deepEqual(await q(`SELECT status FROM challenges WHERE id = '${id(130)}'`), before);
  });

  await check('the dispatcher claims only its own notification types, once', async () => {
    await db.exec(`INSERT INTO notifications (player_id, type, title, body) VALUES
      ('${P1}', 'challenge_received', 'edge-pushed', 'x'), ('${P1}', 'result_submitted', 'edge-pushed', 'x'),
      ('${P1}', 'league_announcement', 'Announcement', 'x');`);
    const claimed = await q(`SELECT type FROM claim_unpushed_notifications(1000)`);
    const types = new Set(claimed.map((r) => r.type));
    assert.ok(types.has('league_announcement') && types.has('challenge_response_due_24h') && types.has('match_deadline_6h'));
    for (const t of types) {
      assert.ok(['match_day_reminder', 'league_announcement', 'challenge_response_due_24h', 'challenge_response_due_6h',
        'challenge_response_overdue', 'match_deadline_24h', 'match_deadline_6h'].includes(t), `unexpected ${t}`);
    }
    assert.equal(await scalar(`SELECT count(*) FROM notifications WHERE type IN ('challenge_received','result_submitted') AND title = 'edge-pushed' AND pushed_at IS NULL`), 2,
      'edge-pushed types are left alone, so they are never pushed twice');
    assert.equal((await q(`SELECT * FROM claim_unpushed_notifications(1000)`)).length, 0, 'a second claim finds nothing');
  });

  await check('the claim limit is respected', async () => {
    await db.exec(`INSERT INTO notifications (player_id, type, title, body)
      SELECT '${P1}', 'league_announcement', 'n' || g, 'x' FROM generate_series(1, 5) g;`);
    assert.equal((await q(`SELECT * FROM claim_unpushed_notifications(2)`)).length, 2);
    assert.equal((await q(`SELECT * FROM claim_unpushed_notifications(10)`)).length, 3);
  });

  await check('admin alerts: unacknowledged ones are claimed once; admins get them, players do not', async () => {
    await db.exec(`INSERT INTO admin_alerts (alert_type, headline) VALUES ('challenge_declined', 'fresh decline');
      INSERT INTO admin_alerts (alert_type, headline, acknowledged_at) VALUES ('x', 'already handled', now())`);
    const claimed = await q(`SELECT headline FROM claim_unpushed_admin_alerts(50)`);
    assert.ok(claimed.some((r) => r.headline === 'fresh decline'), 'a new alert is claimed');
    assert.ok(claimed.some((r) => /past its play-by date/.test(r.headline)), 'so is the overdue-match alert from earlier');
    assert.ok(!claimed.some((r) => r.headline === 'already handled'), 'acknowledged alerts are not pushed');
    assert.equal((await q(`SELECT * FROM claim_unpushed_admin_alerts(50)`)).length, 0, 'claimed once');
    const admins = (await q(`SELECT player_id FROM push_admin_player_ids() ORDER BY 1`)).map((r) => r.player_id);
    assert.deepEqual(admins, [ADMIN_PLAYER, SUPER_PLAYER]);
  });

  await check('the cron job is registered and calls the dispatcher with the vault secret', async () => {
    const jobs = await q(`SELECT jobname, schedule FROM cron.job ORDER BY jobname`);
    assert.deepEqual(jobs, [
      { jobname: 'tof-deadline-reminders', schedule: '20 * * * *' },
      { jobname: 'tof-dispatch-push', schedule: '* * * * *' },
    ]);
    const command = await scalar(`SELECT command FROM cron.job WHERE jobname = 'tof-dispatch-push'`);
    assert.match(command, /https:\/\/dpbgdisezxlttwrxqanu\.supabase\.co\/functions\/v1\/dispatch-push/);
    // Nothing waiting: the real cron SQL must not call out.
    await db.exec(command);
    assert.equal(await scalar(`SELECT count(*) FROM net.calls`), 0, 'quiet league, no call');
    // Only an edge-pushed row waiting: still no call (this is the loop the allowlist prevents).
    await db.exec(`INSERT INTO notifications (player_id, type, title, body) VALUES ('${P1}', 'challenge_received', 'x', 'x')`);
    await db.exec(command);
    assert.equal(await scalar(`SELECT count(*) FROM net.calls`), 0, 'rows the dispatcher never takes must not wake it');
    // A dispatchable row: exactly one call, carrying the secret.
    await db.exec(`INSERT INTO notifications (player_id, type, title, body) VALUES ('${P1}', 'match_day_reminder', 'x', 'x')`);
    await db.exec(command);
    const calls = await q(`SELECT url, secret FROM net.calls`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].secret, await scalar(`SELECT decrypted_secret FROM vault.secrets WHERE name = 'push_dispatch_secret'`));
    // An unacknowledged admin alert also wakes it.
    await db.exec(`DELETE FROM net.calls; UPDATE notifications SET pushed_at = now() WHERE pushed_at IS NULL;
      INSERT INTO admin_alerts (alert_type, headline) VALUES ('challenge_declined', 'x')`);
    await db.exec(command);
    assert.equal(await scalar(`SELECT count(*) FROM net.calls`), 1);
    // No secret in the vault: never call out.
    await db.exec(`DELETE FROM net.calls; DELETE FROM vault.secrets`);
    await db.exec(command);
    assert.equal(await scalar(`SELECT count(*) FROM net.calls`), 0, 'no secret, no call');
  });

  await check('re-running the migration is safe and keeps the same secret', async () => {
    await db.exec(`INSERT INTO vault.secrets VALUES ('push_dispatch_secret', 'keepme')`);
    await db.exec(migration.replace('CREATE EXTENSION IF NOT EXISTS pg_net;', ''));
    assert.equal(await scalar(`SELECT count(*) FROM vault.secrets WHERE name = 'push_dispatch_secret'`), 1);
    assert.equal(await scalar(`SELECT decrypted_secret FROM vault.secrets WHERE name = 'push_dispatch_secret'`), 'keepme');
    assert.equal(await scalar(`SELECT count(*) FROM cron.job WHERE jobname = 'tof-dispatch-push'`), 1);
  });

  console.log(`\n${passed} checks passed`);
} finally {
  await db.close();
}
