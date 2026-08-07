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

const resetMigration = readMigration('admin_stats_reset');
const defenderWinsMigration = readMigration('add_defender_wins');
const challengeCountersMigration = readMigration('add_season_challenge_counters');
const resetControls = read('src/components/admin/StatsResetControls.tsx');
const playerPage = read('src/pages/PlayerPage.tsx');
const playersTab = read('src/components/admin/PlayersTab.tsx');
const settingsTab = read('src/components/admin/SettingsTab.tsx');
const submitResult = read('supabase/functions/submit-result/index.ts');
const addPlayer = read('supabase/functions/add-player/index.ts');

// --- Schema drift repairs -------------------------------------------------
// These columns are written by edge functions but were absent from the
// recovered migration set, so match confirmation and add-player both failed
// against a freshly bootstrapped database.

test('defender_wins exists on both stats tables that write it', () => {
  for (const table of ['player_season_stats', 'player_discipline_stats']) {
    assert.match(
      defenderWinsMigration,
      new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS defender_wins`),
      `${table} must gain defender_wins`,
    );
  }
  // The functions that made this column necessary still reference it.
  assert.match(submitResult, /defender_wins/);
});

test('season challenge counters exist for the functions that write them', () => {
  for (const column of ['challenges_issued', 'challenges_received']) {
    assert.match(
      challengeCountersMigration,
      new RegExp(`ADD COLUMN IF NOT EXISTS ${column} integer NOT NULL DEFAULT 0`),
    );
  }
  // add-player inserts both into player_season_stats; without the columns the
  // insert errors and the new player is rolled back.
  assert.match(addPlayer, /challenges_issued/);
  assert.match(addPlayer, /challenges_received/);
});

// --- Reset semantics ------------------------------------------------------

test('reset zeroes every counter the app renders', () => {
  const zeroed = [
    'wins', 'losses', 'points', 'current_streak', 'best_streak',
    'matches_played', 'forfeits', 'forfeit_wins', 'challenger_wins',
    'defender_wins',
  ];
  for (const column of zeroed) {
    assert.match(
      resetMigration,
      new RegExp(`${column} = 0`),
      `reset must zero ${column}`,
    );
  }
  assert.match(resetMigration, /best_rank_achieved = NULL/);
});

test('reset never touches rankings or deletes matches', () => {
  // Ladder order is managed separately via admin_reorder_rankings, and match
  // rows are the historical record used by disputes and the treasury.
  assert.doesNotMatch(resetMigration, /UPDATE public\.rankings/);
  assert.doesNotMatch(resetMigration, /DELETE FROM public\.matches/i);
});

test('keep-history mode leaves stats_reset_at untouched', () => {
  // p_keep_history=true must not stamp the column, or history would vanish.
  assert.match(
    resetMigration,
    /stats_reset_at = CASE WHEN p_keep_history THEN stats_reset_at ELSE now\(\) END/,
  );
});

test('reset snapshots before mutating so restore is exact', () => {
  const snapshotAt = resetMigration.indexOf('INSERT INTO public.stats_reset_events');
  const firstZeroAt = resetMigration.indexOf('SET wins = 0');
  assert.ok(snapshotAt > 0 && firstZeroAt > 0);
  assert.ok(
    snapshotAt < firstZeroAt,
    'the snapshot insert must run before any counter is zeroed',
  );
});

test('a reset event can only be restored once', () => {
  assert.match(resetMigration, /was already restored/);
  assert.match(resetMigration, /SET restored_at = now\(\), restored_by = auth\.uid\(\)/);
});

// --- Authorization --------------------------------------------------------

test('both reset RPCs require an admin role and are closed to anon', () => {
  for (const fn of ['admin_reset_stats', 'admin_restore_stats']) {
    assert.match(resetMigration, new RegExp(`${fn}: admin role required`));
  }
  assert.match(
    resetMigration,
    /REVOKE ALL ON FUNCTION public\.admin_reset_stats\(uuid, boolean\) FROM PUBLIC, anon/,
  );
  assert.match(
    resetMigration,
    /REVOKE ALL ON FUNCTION public\.admin_restore_stats\(uuid\) FROM PUBLIC, anon/,
  );
});

test('snapshot table is admin-read only and hidden from anon', () => {
  assert.match(resetMigration, /ALTER TABLE public\.stats_reset_events ENABLE ROW LEVEL SECURITY/);
  assert.match(resetMigration, /REVOKE ALL ON TABLE public\.stats_reset_events FROM anon/);
  assert.match(resetMigration, /role IN \('admin', 'super_admin'\)/);
});

// --- UI wiring ------------------------------------------------------------

test('match history respects stats_reset_at so counters and history agree', () => {
  assert.match(playerPage, /stats_reset_at/);
  assert.match(playerPage, /query\.gt\('completed_at', statsResetAt\)/);
  // The reset stamp must be part of the query key, or React Query would serve
  // the pre-reset match list from cache.
  assert.match(playerPage, /queryKey: \['player-matches', id, statsResetAt\]/);
});

test('admin surfaces expose both reset modes and undo', () => {
  assert.match(resetControls, /keep match history/i);
  assert.match(resetControls, /hide past matches/i);
  assert.match(resetControls, /admin_reset_stats/);
  assert.match(resetControls, /admin_restore_stats/);
  assert.match(playersTab, /StatsResetButtons/);
  assert.match(settingsTab, /LeagueStatsResetCard/);
});

test('league-wide reset demands a typed confirmation', () => {
  // One click should not be able to wipe 117 players' records.
  assert.match(resetControls, /const needsTypedConfirm = isLeague/);
  assert.match(resetControls, /toUpperCase\(\) === 'RESET'/);
});

// --- League terminology ---------------------------------------------------

test('no user-facing copy calls this a season', () => {
  // These leagues run continuously — no season start, end or rollover. The
  // player_season_stats table name is inherited from upstream and stays, but
  // nothing a player or admin reads should say "season".
  const allowed = [
    'player_season_stats',   // table name, written by edge functions
    'PlayerSeasonStats',     // its TS type
    'seasonStats',           // local variable derived from that table
    'season_snapshot',       // stats_reset_events column
    'there are no seasons',  // the comment explaining this rule
    'Avoid season',          // ditto
  ];

  const uiFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.tsx')) uiFiles.push(rel);
    }
  };
  walk('src');

  const offenders = [];
  for (const file of uiFiles) {
    for (const [index, line] of read(file).split('\n').entries()) {
      if (!/season/i.test(line)) continue;
      if (allowed.some((token) => line.includes(token))) continue;
      offenders.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these leagues have no seasons — reword:\n${offenders.join('\n')}`,
  );
});
