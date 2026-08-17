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

const visibility = readMigration('restrict_stats_visibility');
const treasuryVisibility = readMigration('restrict_treasury_visibility');
const rankingsPage = read('src/pages/RankingsPage.tsx');
const playerPage = read('src/pages/PlayerPage.tsx');
const useRankings = read('src/hooks/useRankings.ts');
const rankingsTab = read('src/components/admin/RankingsTab.tsx');
const createChallenge = read('supabase/functions/create-challenge/index.ts');

// --- Stats privacy (RLS) ---------------------------------------------------
// Records belong to the player they describe. Enforced in the database, not
// just hidden in the UI — the admin dashboard's role check is client-side.

test('every record table is own-row-or-admin, not world readable', () => {
  for (const table of ['player_season_stats', 'player_discipline_stats', 'matches']) {
    assert.match(
      visibility,
      new RegExp(`DROP POLICY IF EXISTS "[^"]+" ON public\\.${table}`),
      `${table} must drop its old public read policy`,
    );
    assert.match(
      visibility,
      new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM anon`),
      `${table} must be closed to the anon key`,
    );
  }
  // The stats tables key off the player row; matches off either participant.
  assert.match(visibility, /USING \(public\.is_league_admin\(\) OR public\.owns_player\(player_id\)\)/);
  assert.match(visibility, /OR public\.owns_player\(player1_id\)\s*\n\s*OR public\.owns_player\(player2_id\)/);
});

test('no record table keeps a USING (true) read policy', () => {
  const stillPublic = visibility
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .filter((line) => /using \(true\)/i.test(line));
  assert.deepEqual(stillPublic, []);
});

test('the policy helpers cannot be called by anon', () => {
  for (const fn of ['is_league_admin\\(\\)', 'owns_player\\(uuid\\)']) {
    assert.match(visibility, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn} FROM PUBLIC, anon`));
  }
  // SECURITY DEFINER with a pinned search_path, or the helper is an attack path.
  const definers = visibility.match(/SECURITY DEFINER\s+SET search_path = public/g) ?? [];
  assert.equal(definers.length, 2, 'both helpers must pin search_path');
});

test('treasury access is admin-only at the table and both views', () => {
  assert.match(
    treasuryVisibility,
    /DROP POLICY IF EXISTS "Anyone can view treasury" ON public\.treasury_ledger/,
  );
  assert.match(treasuryVisibility, /USING \(public\.is_league_admin\(\)\)/);

  for (const relation of ['treasury_ledger', 'treasury_summary', 'treasury_ledger_effects']) {
    assert.match(
      treasuryVisibility,
      new RegExp(`REVOKE ALL ON public\\.${relation} FROM anon`),
      `${relation} must be closed to the anon key`,
    );
  }

  for (const view of ['treasury_summary', 'treasury_ledger_effects']) {
    assert.match(
      treasuryVisibility,
      new RegExp(`ALTER VIEW public\\.${view} SET \\(security_invoker = true\\)`),
      `${view} must honor the caller's RLS policy`,
    );
  }
});

// --- Stats privacy (UI) ----------------------------------------------------

test("another player's profile shows no record", () => {
  assert.match(playerPage, /const canSeeStats = isSelf \|\| isAdmin/);
  // The three record surfaces are all gated.
  assert.match(playerPage, /\{canSeeStats \? \(/);           // hero win/loss grid
  const gated = playerPage.match(/\{canSeeStats && \(/g) ?? [];
  assert.equal(gated.length, 2, 'discipline stats and match history must both be gated');
  assert.match(playerPage, /Records are private/);
  // Fetching another player's discipline stats is pointless under RLS.
  assert.match(playerPage, /enabled: !!id && canSeeStats/);
});

test('the list shows a win-loss record only for the viewer', () => {
  assert.match(rankingsPage, /\{isMe && rp\.stats && \(/);
});

test('head-to-head survives, because it is the viewer\'s own matches', () => {
  // Those match rows have the viewer as a participant, so the matches policy
  // returns them. Removing this would be a change in scope, not a consequence.
  assert.match(playerPage, /Head to Head/);
});

// --- Inactive players ------------------------------------------------------

test('inactive players are fetched, so they keep their spot', () => {
  assert.doesNotMatch(
    useRankings,
    /from\('players'\)\.select\('\*'\)\.eq\('is_active', true\)/,
    'filtering inactive players out left holes in the numbering',
  );
});

test('the list marks inactive players and never offers a challenge', () => {
  assert.match(rankingsPage, /const isInactive = !rp\.player\.is_active/);
  assert.match(rankingsPage, /Inactive<\/Badge>/);
  // Eligibility runs on active rank, so an inactive player is never eligible.
  assert.match(rankingsPage, /challengeEligibilityOnLadder\(myPosition, pos, activeRanks\)/);
  assert.match(rankingsPage, /canChallengeOnLadder\(myPosition, r\.ranking\.position, activeRanks\)/);
});

test('the profile page uses the skip rule too', () => {
  assert.match(playerPage, /canChallengeOnLadder\(/);
  assert.doesNotMatch(playerPage, /\bcanChallenge\(/);
});

test('the admin reorder list resolves inactive players', () => {
  // admin_reorder_rankings requires a payload covering the whole ladder, and
  // inactive players keep their ranking row — so their names must resolve.
  assert.doesNotMatch(rankingsTab, /select\('id, full_name'\)\.eq\('is_active', true\)/);
  assert.match(rankingsTab, /INACTIVE/);
});

test('the server applies the same skip as the client', () => {
  // A UI that offers a challenge the API then rejects is worse than no skip.
  assert.match(createChallenge, /canChallenge\(myRank, theirRank, challengeRange\)/);
  assert.match(createChallenge, /activeIds\.has\(row\.player_id\)/);
});
