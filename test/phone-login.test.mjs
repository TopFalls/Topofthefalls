import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import * as server from '../supabase/functions/_shared/phoneAuth.ts';
import * as browser from '../src/lib/phone.ts';

// Phone + PIN sign-in. The point of this change is that the app never asks for,
// shows, sends or uses an email address, and that a PIN cannot be guessed past
// the lockout. Behaviour of the SQL is proven by test/phone-login.local.mjs
// (needs a scratch database); this file covers the code and the wiring.

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const noComments = (text) => text.replace(/^\s*(--|\/\/|\*|\/\*).*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const migration = noComments(read('supabase/migrations/20261002120000_phone_login.sql'));
const config = read('supabase/config.toml');
const fn = (name) => noComments(read(`supabase/functions/${name}/index.ts`));
const login = fn('phone-login');
const request = fn('phone-request');
const switcher = fn('switch-to-phone');
const manage = fn('manage-phone-login');

function walk(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

// ---- phone numbers and PINs ------------------------------------------------

test('phone numbers are accepted the way people type them and stored as ten digits', () => {
  for (const typed of ['406-555-0123', '(406) 555-0123', '406.555.0123', '+1 406 555 0123', '1 (406) 555-0123', ' 4065550123 ']) {
    assert.equal(server.normalizePhone(typed), '4065550123', typed);
    assert.equal(browser.normalizePhone(typed), '4065550123', typed);
  }
});

test('things that are not a US phone number are refused', () => {
  for (const typed of ['', '555', '123-456-7890', '406-155-0123', '0000000000', '40655501234', 'abcdefghij', null, undefined, 4065550123]) {
    assert.equal(server.normalizePhone(typed), null, String(typed));
  }
  assert.equal(browser.normalizePhone('123-456-7890'), null);
});

test('the browser and the server agree on every phone number and PIN', () => {
  const samples = ['4065550123', '(406) 555-0123', '+14065550123', '5555555555', '999', '9995550123x', '1-800-555-0199', ''];
  for (const s of samples) assert.equal(browser.normalizePhone(s), server.normalizePhone(s), s);
  for (const s of ['1234', '0000', '123', '12345', 'abcd', ' 1234 ', '12 34', '']) {
    assert.equal(browser.normalizePin(s), server.normalizePin(s), s);
  }
});

test('a PIN is exactly four digits', () => {
  assert.equal(server.normalizePin('0420'), '0420');
  assert.equal(server.normalizePin(' 0420 '), '0420');
  for (const bad of ['042', '04200', 'abcd', '12 3', '', 1234, null]) assert.equal(server.normalizePin(bad), null, String(bad));
});

test('typing a phone number is formatted as they go', () => {
  assert.equal(browser.formatPhoneAsTyped('4'), '4');
  assert.equal(browser.formatPhoneAsTyped('4065'), '(406) 5');
  assert.equal(browser.formatPhoneAsTyped('4065550123'), '(406) 555-0123');
  assert.equal(browser.formatPhoneAsTyped('+1 406 555 0123 99'), '(406) 555-0123');
  assert.equal(browser.pinAsTyped('12a34567'), '1234');
});

test('sign-in goes by the player picked from the list, never by a typed name', () => {
  assert.match(login, /player_id/);
  assert.match(login, /\.eq\('player_id', playerId\)/);
  assert.equal(/login_name|normalizeLoginName/.test(login + request + switcher + manage + migration), false);
  assert.equal(server.playerAttemptKey('ABCDEF00-0000-0000-0000-000000000001'), 'p:abcdef00-0000-0000-0000-000000000001');
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS login_credentials_player/);
});

test('someone removed from the league cannot sign in', () => {
  assert.match(login, /removed_at/);
  assert.match(login, /if \(!credential \|\| !matches \|\| removed\)/);
});

// ---- hashing ---------------------------------------------------------------

test('a PIN is stored salted and only the right phone and PIN match it', async () => {
  const stored = await server.hashSecret('4065550123', '1234', 2000);
  const again = await server.hashSecret('4065550123', '1234', 2000);
  assert.match(stored, /^pbkdf2-sha256\$2000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(stored, again, 'a fresh salt each time');
  assert.equal(stored.includes('1234'), false);
  assert.equal(stored.includes('4065550123'), false);

  assert.equal(await server.verifySecret('4065550123', '1234', stored), true);
  assert.equal(await server.verifySecret('4065550123', '1235', stored), false, 'wrong PIN');
  assert.equal(await server.verifySecret('4065550124', '1234', stored), false, 'wrong phone');
});

test('a player with no sign-in fails the same way, and still does the work', async () => {
  assert.equal(await server.verifySecret('4065550123', '1234', null), false);
  assert.equal(await server.verifySecret('4065550123', '1234', undefined), false);
  assert.equal(await server.verifySecret('4065550123', '1234', 'garbage'), false);
  assert.equal(await server.verifySecret('4065550123', '1234', 'pbkdf2-sha256$2000$zz$zz'), false);
  // The default cost is what a stored hash carries, so a real check is not cheaper than a fake one.
  assert.equal(server.HASH_ITERATIONS >= 600_000, true);
});

test('the placeholder identifier can never be mailed to', () => {
  assert.equal(server.internalEmailFor('abc'), 'u-abc@phone-login.invalid');
  assert.match(server.INTERNAL_EMAIL_DOMAIN, /\.invalid$/);
});

test('every failed sign-in says the same thing', () => {
  assert.match(server.SIGN_IN_FAILED, /don't match/);
  assert.equal(login.includes('SIGN_IN_FAILED'), true);
  // one exit for "no such sign-in", "wrong secret" and "removed"
  assert.match(login, /return json\(\{ error: SIGN_IN_FAILED \}, 401\)/);
});

// ---- the lockout is in front of the check ----------------------------------

test('the sign-in counts the try before it looks at the secret', () => {
  const ip = login.indexOf("rpc('login_begin_attempt'");
  const name = login.indexOf("rpc('login_begin_attempt'", ip + 10);
  const lookup = login.indexOf("from('login_credentials')");
  const verify = login.indexOf('verifySecret(');
  assert.ok(ip > 0 && name > ip && lookup > name && verify > lookup, 'address, player, lookup, verify — in that order');
  assert.equal(login.split('return json({ error: LOCKED_OUT }, 429)').length - 1, 2, 'refused by address and by player');
  assert.match(login, /if \(ipOk !== true\)/);
  assert.match(login, /if \(playerOk !== true\)/);
});

test('a correct sign-in clears the player counter but never the address counter', () => {
  assert.match(login, /rpc\('login_clear_attempts', \{ p_key: attemptKey \}\)/);
  assert.equal(login.includes("login_clear_attempts', { p_key: ipKey"), false);
});

test('the session is minted from an admin link that is redeemed, not emailed', () => {
  assert.match(login, /generateLink\(\{\s*type: 'magiclink'/);
  assert.match(login, /verifyOtp\(\{ token_hash/);
  assert.equal(/signInWithOtp|inviteUserByEmail|resetPasswordForEmail/.test(login), false);
});

test('the lockout doubles each time, is capped, and forgets after a quiet day', () => {
  assert.match(migration, /power\(2, r\.strikes\)/);
  assert.match(migration, /interval '24 hours'/);
  assert.match(migration, /FOR UPDATE/);
});

test('the request function is rate limited, answers the same way, and never lets anyone in', () => {
  assert.match(request, /login_begin_attempt/);
  assert.match(request, /MAX_WAITING_PER_PLAYER/);
  assert.equal(/generateLink|createUser|login_credentials/.test(request), false, 'it only leaves a request');
});

// ---- what a browser can and cannot reach -----------------------------------

test('no browser role can touch the credential, request or counter tables', () => {
  for (const table of ['login_credentials', 'login_requests', 'login_attempts']) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`REVOKE ALL ON public\\.${table}\\s+FROM PUBLIC, anon, authenticated`));
  }
  assert.equal(/CREATE POLICY/i.test(migration), false, 'no policy: only service_role gets through');
  assert.equal(/GRANT[^;]*\bTO\b[^;]*\b(anon|authenticated)\b/i.test(migration.replace(/GRANT EXECUTE ON FUNCTION public\.my_login_status\(\) TO authenticated, service_role;/, '')), false);
});

test('the throttle functions are for the server only, and the one browser question is a yes or no', () => {
  for (const f of ['login_begin_attempt(text, integer, interval, interval)', 'login_clear_attempts(text)', 'login_prune_attempts()']) {
    const flat = migration.replace(/[ \t]+/g, ' ');
    assert.ok(flat.includes(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`), f);
    assert.ok(flat.includes(`GRANT EXECUTE ON FUNCTION public.${f} TO service_role;`), f);
  }
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.my_login_status\(\)\s+RETURNS boolean/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.my_login_status\(\) FROM PUBLIC, anon;/);
});

test('every function in the migration pins its search_path', () => {
  const functions = migration.split(/CREATE OR REPLACE FUNCTION/).slice(1);
  assert.equal(functions.length, 4);
  for (const body of functions) {
    const header = body.slice(0, body.indexOf('$$'));
    assert.match(header, /SET search_path = public/, header.split('\n')[0]);
  }
});

test('the phone number is wiped when an admin decides, and never stored beside an approved login', () => {
  assert.match(manage, /phone: null/);
  assert.equal(/phone:\s*request\.phone|phone:\s*phone/.test(manage), false);
  assert.match(migration, /phone_last4\s+text NOT NULL/);
});

test('only admins can see or decide requests, and nobody approves their own', () => {
  assert.match(manage, /\['admin', 'super_admin'\]\.includes\(me\.role\)/);
  assert.match(manage, /player\.profile_id === user\.id/);
  const check = manage.indexOf('Admins only');
  assert.ok(check > 0 && check < manage.indexOf("action === 'list'"), 'role check precedes every action');
});

test('switching over needs a login and a claimed name, and only works once', () => {
  assert.match(switcher, /auth\.getUser\(token\)/);
  assert.match(switcher, /Claim your name on the list first/);
  assert.match(switcher, /already switched/);
});

test('an approved name keeps its existing account, so history and roles carry over', () => {
  assert.match(manage, /let userId = player\.profile_id/);
  assert.match(manage, /if \(!userId\)/);
  assert.match(manage, /\.is\('profile_id', null\)/);
});

// ---- the functions that run before there is a login are declared public ----

test('the two pre-login functions are public on purpose, in both places', () => {
  for (const name of ['phone-login', 'phone-request']) {
    assert.match(read(`supabase/functions/${name}/index.ts`), /^\/\/ tof-guard: public/m, name);
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = false`), name);
  }
  for (const name of ['switch-to-phone', 'manage-phone-login']) {
    assert.doesNotMatch(config, new RegExp(`\\[functions\\.${name}\\]`), `${name} must keep verifying the caller`);
  }
});

test('no function leaks internal error text to the caller', () => {
  for (const code of [login, request, switcher, manage]) {
    assert.match(code, /return json\(\{ error: 'Something went wrong\. Please try again\.' \}, 500\)/);
    assert.equal(/json\(\{ error: (e|err|error)\b/.test(code), false);
  }
});

test('nothing logs a phone number, a PIN or a token', () => {
  for (const code of [login, request, switcher, manage]) {
    for (const line of code.split('\n').filter((l) => /console\./.test(l))) {
      assert.equal(/phone|pin|secret|token|body|session/i.test(line.replace(/'[^']*'/, '')), false, line.trim());
    }
  }
});

// ---- email is gone from the app --------------------------------------------

test('the app never asks for, shows, sends or reads an email address', () => {
  const files = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && f !== join('src', 'types', 'database.ts'));
  assert.ok(files.length > 20);
  for (const f of files) {
    const text = noComments(read(f));
    assert.equal(/signInWithOtp|verifyOtp|mailto:|type="email"|inputMode="email"|autoComplete="email"|\.email\b/.test(text), false, f);
    assert.equal(/e-?mail/i.test(text.replace(/\/\/.*$/gm, '')), false, `${f} mentions email`);
  }
});

test('the old emailed-link page is gone and its route sends people to sign in', () => {
  assert.equal(existsSync(join(root, 'src/pages/AuthCallbackPage.tsx')), false);
  assert.match(read('src/App.tsx'), /path="\/auth\/callback" element=\{<Navigate to="\/login" replace \/>\}/);
});

test('admins cannot invite anyone by email any more', () => {
  const add = read('supabase/functions/add-player/index.ts');
  assert.equal(/inviteUserByEmail|EMAIL_RE|normalizeEmail|findAuthUserByEmail/.test(add), false);
  assert.equal(/e-?mail/i.test(noComments(add)), false);
});

test('the only place an identifier looks like an address is the server-side placeholder', () => {
  const hits = walk('supabase/functions')
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => /@|internalEmailFor|\.email\b/.test(noComments(read(f))));
  const allowed = new Set([
    join('supabase', 'functions', '_shared', 'phoneAuth.ts'),
    join('supabase', 'functions', 'phone-login', 'index.ts'),
    join('supabase', 'functions', 'manage-phone-login', 'index.ts'),
  ]);
  for (const f of hits) {
    // a deno.land / esm.sh import is not an address
    const text = noComments(read(f)).replace(/https:\/\/[^\s'"]+/g, '');
    if (!/@|internalEmailFor|\.email\b/.test(text)) continue;
    assert.ok(allowed.has(f), `${f} handles an email-shaped value`);
  }
});

// ---- signing in and the route guard ----------------------------------------

test('everyone who signed in the old way is sent to switch, and the screen closes afterwards', () => {
  const layout = read('src/components/Layout.tsx');
  assert.match(layout, /rpc\('my_login_status'\)/);
  assert.match(layout, /hasPhoneLogin === false && path !== '\/switch-login'/);
  assert.match(layout, /hasPhoneLogin === true && path === '\/switch-login'/);
  // a failed answer must not shut anyone out
  assert.match(layout, /setHasPhoneLogin\(loginRes\.error \? null/);
});

test('the sign-in screen offers the name list, a phone and a PIN, and nothing else', () => {
  const page = read('src/pages/LoginPage.tsx');
  assert.match(page, /NamePicker/);
  assert.match(page, /name="phone"/);
  assert.match(page, /name="pin"/);
  assert.match(page, /type="password"/);
  assert.match(page, /signInWithPhone/);
  assert.match(page, /requestToJoin/);
});

test('nothing sensitive is kept in the browser', () => {
  for (const f of ['src/lib/phoneLogin.ts', 'src/pages/LoginPage.tsx', 'src/pages/SwitchLoginPage.tsx']) {
    const text = noComments(read(f));
    assert.equal(/localStorage|sessionStorage|console\./.test(text), false, f);
  }
});

test('the admin screen is reachable and an open request raises an alert', () => {
  assert.match(read('src/pages/AdminPage.tsx'), /<SignInsTab \/>/);
  assert.match(read('src/components/admin/AdminAlertsCard.tsx'), /login_request/);
  assert.match(request, /alert_type: 'login_request'/);
});
