// Optional integration test: isolated in-memory PostgreSQL, never production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../work/deadline-test/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const scalar = async (sql) => Object.values((await db.query(sql)).rows[0])[0];
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
    CREATE TABLE profiles (id uuid PRIMARY KEY, role text NOT NULL);
    CREATE TABLE players (id uuid PRIMARY KEY, full_name text NOT NULL);
    CREATE FUNCTION public.is_league_admin() RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS
      'SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN (''admin'', ''super_admin''))';
    CREATE TABLE challenges (id uuid PRIMARY KEY, challenger_id uuid, challenged_id uuid,
      discipline text, status text, expires_at timestamptz, match_deadline timestamptz);
    CREATE TABLE matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), challenge_id uuid,
      status text, completed_at timestamptz);
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobname text, schedule text, command text);
    CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
    CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO cron.job VALUES ($1, $2, $3); RETURN 1; END; $$;
  `);
  // Execute the existing admin table and its actual RLS policies, not a substitute.
  const baseline = readFileSync('supabase/migrations/20260810140000_inactive_lifecycle_and_wash.sql', 'utf8');
  await db.exec(baseline.slice(baseline.indexOf('CREATE TABLE IF NOT EXISTS public.admin_alerts'), baseline.indexOf('-- Every cooldown')));
  await db.exec(readFileSync('supabase/migrations/20260912160000_admin_deadline_reminders.sql', 'utf8'));
  await db.exec(`BEGIN;
    INSERT INTO players VALUES ('${id(1)}', 'Player One'), ('${id(2)}', 'Player Two');
    INSERT INTO profiles VALUES ('${id(3)}', 'admin'), ('${id(4)}', 'super_admin'), ('${id(5)}', 'player');
  `);
  const cases = [
    ['pending', "now() + interval '12 hours'", 'NULL', true],
    ['pending', "now() + interval '12 hours 1 second'", 'NULL', false],
    ['pending', 'now()', 'NULL', false],
    ['pending', "now() - interval '1 second'", 'NULL', false],
    ['pending', "now() + interval '1 second'", 'NULL', true],
    ['scheduled', "now() - interval '8 days'", "now() + interval '12 hours'", true],
    ['accepted', 'now()', "now() + interval '1 hour'", true],
    ['in_progress', 'now()', "now() + interval '2 hours'", true],
    ['cancelled', "now() + interval '1 hour'", "now() + interval '1 hour'", false],
    ['confirmed', 'now()', "now() + interval '1 hour'", false],
    ['scheduled', 'now()', 'NULL', false],
    ['scheduled', 'now()', "now() + interval '12 hours 1 second'", false],
    ['scheduled', 'now()', 'now()', false],
    ['scheduled', 'now()', "now() + interval '1 hour'", false, 'submitted'],
    ['scheduled', 'now()', "now() + interval '1 hour'", false, 'confirming'],
    ['scheduled', 'now()', "now() + interval '1 hour'", false, 'disputed'],
    ['scheduled', 'now()', "now() + interval '1 hour'", false, 'confirmed'],
    ['scheduled', 'now()', "now() + interval '1 hour'", false, 'resolved'],
    ['scheduled', 'now()', "now() + interval '1 hour'", false, 'scheduled', true],
    ['washed', 'now()', "now() + interval '1 hour'", false],
  ];
  for (const [i, [status, expires, deadline, , matchStatus, completed]] of cases.entries()) {
    await db.exec(`INSERT INTO challenges VALUES ('${id(100 + i)}', '${id(1)}', '${id(2)}',
      '8 Ball', '${status}', ${expires}, ${deadline});`);
    if (matchStatus) await db.exec(`INSERT INTO matches(challenge_id, status, completed_at)
      VALUES ('${id(100 + i)}', '${matchStatus}', ${completed ? 'now()' : 'NULL'});`);
  }
  assert.equal(await scalar('SELECT public.send_admin_deadline_reminders()'), 5);
  for (const [i, row] of cases.entries()) {
    assert.equal(await scalar(`SELECT count(*)::int FROM admin_alerts WHERE challenge_id = '${id(100 + i)}'`), row[3] ? 1 : 0, `deadline case ${i}`);
  }
  assert.equal(await scalar('SELECT public.send_admin_deadline_reminders()'), 0, 'repeat run');
  await db.exec('UPDATE admin_alerts SET acknowledged_at = now()');
  assert.equal(await scalar('SELECT public.send_admin_deadline_reminders()'), 0, 'Done does not resend');
  await db.exec(`UPDATE challenges SET expires_at = expires_at - interval '1 second' WHERE id = '${id(100)}'`);
  assert.equal(await scalar('SELECT public.send_admin_deadline_reminders()'), 1, 'changed deadline');
  assert.match(await scalar('SELECT detail FROM admin_alerts LIMIT 1'), /Player One vs Player Two.*Mountain time/);
  assert.equal(await scalar("SELECT schedule FROM cron.job WHERE jobname = 'tof-admin-deadline-reminders'"), '0 * * * *');
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await scalar(`SELECT has_function_privilege('${role}', 'public.send_admin_deadline_reminders()', 'EXECUTE')`), false);
  }
  assert.equal(await scalar("SELECT has_function_privilege('service_role', 'public.send_admin_deadline_reminders()', 'EXECUTE')"), true);
  assert.equal(await scalar("SELECT has_table_privilege('anon', 'public.admin_alerts', 'SELECT')"), false);
  for (const [profileId, expected] of [[3, 6], [4, 6], [5, 0]]) {
    await db.exec(`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${id(profileId)}', true)`);
    assert.equal(await scalar('SELECT count(*)::int FROM admin_alerts'), expected, `RLS profile ${profileId}`);
    assert.equal(await scalar("WITH changed AS (UPDATE admin_alerts SET acknowledged_at = now() RETURNING id) SELECT count(*)::int FROM changed"), expected);
    await db.exec('RESET ROLE');
  }
  await db.exec('ROLLBACK');
  console.log('PASS: 20 deadline/state cases, duplicate and renewed deadlines, admin/super-admin/member/guest access, function privileges, cron registration. In-memory database only.');
} finally {
  await db.close();
}
