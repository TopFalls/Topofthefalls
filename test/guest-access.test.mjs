import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const migrationDir = 'supabase/migrations';
const migrationNames = readdirSync(join(root, migrationDir));
const readMigration = (fragment) => {
  const name = migrationNames.find((file) => file.includes(fragment));
  assert.ok(name, `expected a migration matching "${fragment}"`);
  return read(join(migrationDir, name));
};

// These migrations explain themselves at length, and the prose quotes the very
// SQL the assertions below forbid ("... carried USING (true)"). Match statements,
// not commentary.
const sqlOnly = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const views       = sqlOnly(readMigration('public_read_views_for_guests'));
const lockdown    = sqlOnly(readMigration('guests_get_the_views_and_nothing_else'));
const feedPolicy  = sqlOnly(readMigration('hide_treasury_from_activity_feed'));
const guestTheme  = sqlOnly(readMigration('guest_theme'));
const layout      = read('src/components/Layout.tsx');
const useLive     = read('src/hooks/useLiveMatches.ts');
const useRankings = read('src/hooks/useRankings.ts');
const themeProvider = read('src/theme/ThemeProvider.tsx');
const keepalive   = read('.github/workflows/keepalive.yml');

const GUEST_VIEWS = [
  'public_players',
  'public_rankings',
  'public_player_metrics',
  'public_activity_feed',
  'public_live_matches',
];

const TREASURY_EVENTS = [
  'treasury_entry_credit',
  'treasury_entry_debit',
  'treasury_entry_corrected',
  'treasury_entry_reversed',
];

// --- The guest surface is exactly five views --------------------------------
// Signed-out visitors reach the open internet's copy of this league. Anything
// that widens what they can read should have to break a test first.

test('anon loses every table and gets SELECT on the guest views alone', () => {
  assert.match(lockdown, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon/);
  assert.match(lockdown, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon/);

  for (const view of GUEST_VIEWS) {
    assert.match(
      lockdown,
      new RegExp(`GRANT SELECT ON public\\.${view}\\s+TO anon`),
      `${view} must be readable by a guest`,
    );
  }

  // SELECT and nothing else — no INSERT/UPDATE/DELETE anywhere in the file.
  assert.doesNotMatch(lockdown, /GRANT[^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]*TO[^;]*anon/is);
});

test('a table added later is not published to guests by accident', () => {
  // Supabase's shipped default grants every new table to anon. Without this,
  // the next CREATE TABLE quietly reopens what the migration above closed.
  assert.match(
    lockdown,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s*\n\s*REVOKE ALL ON TABLES FROM anon/,
  );
});

test('every guest view names its columns, so new columns stay unpublished', () => {
  // A `SELECT *` view would republish whatever a future migration adds to the
  // base table — an email or a phone number would go straight to the internet.
  assert.doesNotMatch(views, /SELECT\s+\*/i);
  assert.doesNotMatch(views, /SELECT\s+\w+\.\*/i);
});

test('the guest views are the boundary, not the caller', () => {
  for (const view of GUEST_VIEWS) {
    assert.match(
      views,
      new RegExp(`ALTER VIEW public\\.${view}\\s+SET \\(security_invoker = false, security_barrier = true\\)`),
      `${view} must filter with its own rights and block predicate pushdown`,
    );
  }
});

// --- The treasury stays shut ------------------------------------------------

test('the activity feed no longer leaks the treasury to players', () => {
  // manage-treasury writes "Admin added $250.00 credit to league treasury" into
  // the feed, and the feed used to be USING (true).
  assert.match(feedPolicy, /DROP POLICY IF EXISTS "Anyone can view activity feed" ON public\.activity_feed/);
  assert.match(feedPolicy, /TO authenticated/);
  assert.match(feedPolicy, /public\.is_league_admin\(\)/);
  for (const event of TREASURY_EVENTS) {
    assert.ok(feedPolicy.includes(`'${event}'`), `${event} must be admin-only in the feed`);
  }
  assert.doesNotMatch(feedPolicy, /USING \(true\)/i);
});

test('the guest feed drops treasury rows and per-player match fees', () => {
  const guestFeed = views.slice(views.indexOf('CREATE OR REPLACE VIEW public.public_activity_feed'));
  for (const event of [...TREASURY_EVENTS, 'match_fee_recorded']) {
    assert.ok(guestFeed.includes(`'${event}'`), `${event} must be excluded from the guest feed`);
  }
  // match_fee_recorded names a player and how they paid; that is league
  // business, not something a stranger needs.
  assert.match(views, /NOT IN \(/);
});

// --- Live scores are a scoreboard, not the match record ---------------------

test('the live view carries scores only, and only while a match is live', () => {
  const live = views.slice(views.indexOf('CREATE OR REPLACE VIEW public.public_live_matches'));
  assert.match(live, /WHERE m\.status = 'in_progress'/);
  for (const leak of [
    'payment_method',
    'winner_id',
    'loser_id',
    'submitted',
    'confirmed',
    'challenge_id',
    'paid',
  ]) {
    assert.ok(
      !live.includes(leak),
      `public_live_matches must not expose ${leak} — it is a scoreboard, not the result`,
    );
  }
});

test('the matches table itself stays private to its two players', () => {
  // Widening the matches policy would have been the easy way to ship live
  // scores and would have taken payment details along with it.
  assert.match(useLive, /from\('public_live_matches'\)/);
  assert.doesNotMatch(useLive, /from\('matches'\)/);
});

// --- The app agrees with the database ---------------------------------------

test('the guest route list matches what the database actually grants', () => {
  const declared = layout.match(/const GUEST_ROUTES = \[([^\]]*)\]/);
  assert.ok(declared, 'Layout must declare GUEST_ROUTES');
  const routes = [...declared[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(routes.sort(), ['/', '/activity', '/rankings']);

  // A player's own record, the treasury and the match screens all read tables
  // anon cannot touch, so routing a guest there would only produce an error.
  for (const closed of ['/player', '/treasury', '/matches', '/challenges', '/settings', '/admin']) {
    assert.ok(!routes.includes(closed), `${closed} must stay behind sign-in`);
  }
});

test('the theme loads before sign-in without opening league_settings', () => {
  // ThemeProvider runs before anything knows whether there is a session. If it
  // reads a table anon cannot touch, guests silently get the fallback theme
  // and Carl's brand colours never reach them.
  assert.match(themeProvider, /from\('public_league_settings'\)/);
  assert.doesNotMatch(themeProvider, /from\('league_settings'\)/);
  assert.match(guestTheme, /GRANT SELECT ON public\.public_league_settings TO anon/);
  // Fee and scheduling config are not a guest's business.
  const exposed = guestTheme.match(/SELECT s\.(\w+)/g) ?? [];
  assert.deepEqual(exposed, ['SELECT s.theme_name']);
});

test('the ladder reads the guest views, so one hook serves both', () => {
  assert.match(useRankings, /from\('public_players'\)/);
  assert.match(useRankings, /from\('public_rankings'\)/);
  assert.match(useRankings, /from\('public_player_metrics'\)/);
  // Records stay on the base table: your own row, or an admin's view of all.
  assert.match(useRankings, /from\('player_season_stats'\)/);
});

test('the keep-alive ping targets something anon can still read', () => {
  // It asserts HTTP 200 and fails the job otherwise, so pinging a table the
  // anon role lost would report the project as paused every run.
  assert.match(keepalive, /rest\/v1\/public_rankings\?select=position/);
  assert.doesNotMatch(keepalive, /rest\/v1\/rankings\?select=position/);
});
