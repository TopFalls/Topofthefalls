// Optional integration test: isolated in-memory PostgreSQL, never production.
//
// Runs the real 20261002120000 migration against stub tables and proves the
// lockout counts, escalates, caps and forgets, that the credential tables are
// closed to every browser role, and that each player and account has one sign-in. Setup,
// from the repo root:
//   mkdir -p work/deadline-test && cd work/deadline-test && npm init -y && npm i @electric-sql/pglite
// Run:  node test/phone-login.local.mjs     (delete work/ afterwards; never commit it)
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
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`ok  ${name}`); };
const attempt = (key, max = 5, window = '15 minutes', lock = '15 minutes') =>
  scalar(`SELECT public.login_begin_attempt('${key}', ${max}, interval '${window}', interval '${lock}')`);
const asRole = async (role, sql) => {
  await db.exec(`SET ROLE ${role}`);
  try { return await q(sql); } finally { await db.exec('RESET ROLE'); }
};

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    -- Supabase hands every new public table to the browser roles; the migration has to take that back.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    CREATE TABLE profiles (id uuid PRIMARY KEY, role text NOT NULL);
    CREATE TABLE players (id uuid PRIMARY KEY, full_name text NOT NULL, profile_id uuid);
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobname text, schedule text, command text);
    CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE plpgsql AS
      $$ BEGIN DELETE FROM cron.job WHERE jobname = $1; RETURN true; END; $$;
    CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE plpgsql AS
      $$ BEGIN INSERT INTO cron.job VALUES ($1, $2, $3); RETURN 1; END; $$;
    INSERT INTO auth.users VALUES ('${id(1)}'), ('${id(2)}'), ('${id(3)}');
    INSERT INTO players VALUES ('${id(11)}', 'Carl Higgins', '${id(1)}'), ('${id(12)}', 'Dan  Smith', '${id(2)}'), ('${id(13)}', 'Unclaimed Person', NULL);
  `);
  await db.exec(readFileSync('supabase/migrations/20261002120000_phone_login.sql', 'utf8'));
  // applying it twice must be harmless (migrations here are sometimes re-run by hand)
  await db.exec(readFileSync('supabase/migrations/20261002120000_phone_login.sql', 'utf8'));

  await check('five tries are allowed, the sixth is locked out', async () => {
    for (let i = 1; i <= 5; i += 1) assert.equal(await attempt('p:dan'), true, `try ${i}`);
    assert.equal(await attempt('p:dan'), false, 'sixth try');
    assert.equal(await attempt('p:dan'), false, 'still locked');
  });

  await check('a locked name does not lock anyone else', async () => {
    assert.equal(await attempt('p:carl'), true);
  });

  await check('a try made during a lock does not extend it or pile up failures', async () => {
    const before = await q(`SELECT failures, strikes, locked_until FROM login_attempts WHERE key = 'p:dan'`);
    await attempt('p:dan'); await attempt('p:dan');
    const after = await q(`SELECT failures, strikes, locked_until FROM login_attempts WHERE key = 'p:dan'`);
    assert.deepEqual(after, before);
    assert.equal(before[0].strikes, 1);
    assert.equal(before[0].failures, 0);
  });

  await check('the first lock lasts the base time', async () => {
    const minutes = await scalar(`SELECT round(extract(epoch FROM locked_until - now()) / 60) FROM login_attempts WHERE key = 'p:dan'`);
    assert.ok(minutes >= 14 && minutes <= 15, `locked for ${minutes} minutes`);
  });

  await check('once the lock runs out they can try again, and the next lock is twice as long', async () => {
    await db.exec(`UPDATE login_attempts SET locked_until = now() - interval '1 second' WHERE key = 'p:dan'`);
    for (let i = 1; i <= 5; i += 1) assert.equal(await attempt('p:dan'), true, `try ${i}`);
    assert.equal(await attempt('p:dan'), false);
    const minutes = await scalar(`SELECT round(extract(epoch FROM locked_until - now()) / 60) FROM login_attempts WHERE key = 'p:dan'`);
    assert.ok(minutes >= 29 && minutes <= 30, `locked for ${minutes} minutes`);
  });

  await check('locks never grow past a day', async () => {
    await db.exec(`UPDATE login_attempts SET locked_until = now() - interval '1 second', strikes = 20 WHERE key = 'p:dan'`);
    for (let i = 1; i <= 5; i += 1) await attempt('p:dan');
    assert.equal(await attempt('p:dan'), false);
    const hours = await scalar(`SELECT round(extract(epoch FROM locked_until - now()) / 3600) FROM login_attempts WHERE key = 'p:dan'`);
    assert.equal(Number(hours), 24);
  });

  await check('a correct sign-in wipes the name counter', async () => {
    await db.exec(`SELECT public.login_clear_attempts('p:dan')`);
    assert.equal(await scalar(`SELECT count(*) FROM login_attempts WHERE key = 'p:dan'`), 0);
    for (let i = 1; i <= 5; i += 1) assert.equal(await attempt('p:dan'), true);
  });

  await check('slow, spread-out tries are not counted against someone for ever', async () => {
    await db.exec(`DELETE FROM login_attempts`);
    for (let i = 1; i <= 4; i += 1) await attempt('p:slow');
    await db.exec(`UPDATE login_attempts SET window_started_at = now() - interval '16 minutes' WHERE key = 'p:slow'`);
    for (let i = 1; i <= 5; i += 1) assert.equal(await attempt('p:slow'), true, `try ${i} in a new window`);
  });

  await check('a quiet day forgets earlier locks', async () => {
    await db.exec(`UPDATE login_attempts SET strikes = 6, updated_at = now() - interval '25 hours', window_started_at = now() - interval '25 hours' WHERE key = 'p:slow'`);
    for (let i = 1; i <= 5; i += 1) await attempt('p:slow');
    assert.equal(await attempt('p:slow'), false);
    const minutes = await scalar(`SELECT round(extract(epoch FROM locked_until - now()) / 60) FROM login_attempts WHERE key = 'p:slow'`);
    assert.ok(minutes >= 14 && minutes <= 15, `locked for ${minutes} minutes, not hours`);
  });

  await check('the address limit works the same way with its own numbers', async () => {
    for (let i = 1; i <= 40; i += 1) assert.equal(await attempt('i:abc', 40, '10 minutes', '10 minutes'), true);
    assert.equal(await attempt('i:abc', 40, '10 minutes', '10 minutes'), false);
  });

  await check('old counters are swept, live locks are kept', async () => {
    await db.exec(`DELETE FROM login_attempts`);
    await db.exec(`INSERT INTO login_attempts (key, updated_at) VALUES ('old', now() - interval '8 days'), ('fresh', now())`);
    await db.exec(`INSERT INTO login_attempts (key, updated_at, locked_until) VALUES ('oldlocked', now() - interval '8 days', now() + interval '1 hour')`);
    await db.exec(`SELECT public.login_prune_attempts()`);
    const keys = (await q(`SELECT key FROM login_attempts ORDER BY key`)).map((r) => r.key);
    assert.deepEqual(keys, ['fresh', 'oldlocked']);
  });

  await check('the sweep and the lockout are scheduled', async () => {
    assert.equal(await scalar(`SELECT count(*) FROM cron.job WHERE jobname = 'tof-prune-login-attempts'`), 1);
  });

  await check('a player has one sign-in, an account has one, and the phone hint is four digits', async () => {
    await db.exec(`INSERT INTO login_credentials (user_id, player_id, secret_hash, phone_last4)
                   VALUES ('${id(1)}', '${id(11)}', 'h', '0123')`);
    await assert.rejects(db.exec(`INSERT INTO login_credentials (user_id, player_id, secret_hash, phone_last4)
                   VALUES ('${id(3)}', '${id(11)}', 'h', '0123')`), /duplicate key/, 'same player twice');
    await assert.rejects(db.exec(`INSERT INTO login_credentials (user_id, player_id, secret_hash, phone_last4)
                   VALUES ('${id(1)}', '${id(12)}', 'h', '0123')`), /duplicate key/, 'same account twice');
    await assert.rejects(db.exec(`INSERT INTO login_credentials (user_id, player_id, secret_hash, phone_last4)
                   VALUES ('${id(2)}', '${id(12)}', 'h', '01234')`), /check constraint/);
  });

  await check('a request keeps only its last four digits once the phone is wiped, and unknown statuses are refused', async () => {
    await db.exec(`INSERT INTO login_requests (player_id, phone, phone_last4, secret_hash) VALUES ('${id(13)}', '4065550123', '0123', 'h')`);
    await db.exec(`UPDATE login_requests SET status = 'approved', phone = NULL`);
    assert.equal(await scalar(`SELECT phone IS NULL FROM login_requests`), true);
    await assert.rejects(db.exec(`UPDATE login_requests SET status = 'whatever'`), /check constraint/);
  });

  await check('a signed-in member can ask whether they have switched, and only about themselves', async () => {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${id(1)}', false)`);
    assert.equal((await asRole('authenticated', `SELECT public.my_login_status() AS v`))[0].v, true);
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${id(2)}', false)`);
    assert.equal((await asRole('authenticated', `SELECT public.my_login_status() AS v`))[0].v, false);
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
    assert.equal((await asRole('authenticated', `SELECT public.my_login_status() AS v`))[0].v, false);
  });

  for (const role of ['anon', 'authenticated']) {
    await check(`${role} cannot read, write or guess against any sign-in table`, async () => {
      for (const t of ['login_credentials', 'login_requests', 'login_attempts']) {
        await assert.rejects(asRole(role, `SELECT * FROM ${t}`), /permission denied/, `${role} select ${t}`);
        await assert.rejects(asRole(role, `DELETE FROM ${t}`), /permission denied/, `${role} delete ${t}`);
      }
      await assert.rejects(asRole(role, `SELECT public.login_begin_attempt('x', 5, interval '1 minute', interval '1 minute')`), /permission denied/);
      await assert.rejects(asRole(role, `SELECT public.login_clear_attempts('p:carl')`), /permission denied/);
    });
  }

  await check('anon cannot even ask whether someone has switched', async () => {
    await assert.rejects(asRole('anon', `SELECT public.my_login_status()`), /permission denied/);
  });

  await check('the server role can use all of it', async () => {
    assert.ok((await asRole('service_role', `SELECT * FROM login_credentials`)).length === 1);
    assert.equal((await asRole('service_role', `SELECT public.login_begin_attempt('svc', 5, interval '1 minute', interval '1 minute') AS v`))[0].v, true);
  });

  console.log(`\n${passed} database checks passed`);
} finally {
  await db.close();
}
