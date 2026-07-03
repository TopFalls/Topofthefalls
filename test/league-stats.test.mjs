import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLeagueStats, winPct } from '../src/lib/leagueStats.ts';

const NOW = Date.parse('2026-07-01T12:00:00Z');
const DAY = 86400000;

function player(id, overrides = {}) {
  return {
    id,
    full_name: `Player ${id}`,
    profile_id: null,
    is_active: true,
    preferred_discipline: null,
    avatar_url: null,
    created_at: new Date(NOW - 90 * DAY).toISOString(),
    ...overrides,
  };
}

function match(id, overrides = {}) {
  return {
    id,
    player1_id: 'a',
    player2_id: 'b',
    discipline: '8 Ball',
    race_length: 6,
    venue: 'Silver Spur',
    player1_score: 6,
    player2_score: 3,
    winner_id: 'a',
    loser_id: 'b',
    status: 'confirmed',
    player1_payment_method: 'cash_envelope',
    player2_payment_method: 'venmo',
    scheduled_at: new Date(NOW - 2 * DAY).toISOString(),
    completed_at: new Date(NOW - 2 * DAY).toISOString(),
    created_at: new Date(NOW - 3 * DAY).toISOString(),
    ...overrides,
  };
}

function seasonStats(playerId, overrides = {}) {
  return {
    id: `s-${playerId}`,
    player_id: playerId,
    wins: 0, losses: 0, current_streak: 0, best_streak: 0, matches_played: 0,
    challenges_issued: 0, challenges_received: 0, defender_wins: 0,
    challenger_wins: 0, forfeit_wins: 0, forfeits: 0, best_rank_achieved: null,
    updated_at: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    players: [player('a'), player('b'), player('c', { is_active: false, profile_id: 'p-c' })],
    rankings: [
      { id: 'r1', player_id: 'a', position: 1, previous_position: 2, rank1_since: null, updated_at: '' },
      { id: 'r2', player_id: 'b', position: 2, previous_position: 1, rank1_since: null, updated_at: '' },
    ],
    seasonStats: [
      seasonStats('a', { wins: 8, losses: 2, matches_played: 10, best_streak: 5, challenges_issued: 7 }),
      seasonStats('b', { wins: 9, losses: 1, matches_played: 10, best_streak: 4, challenges_issued: 2 }),
      // inactive player must be excluded from leaders even with the best record
      seasonStats('c', { wins: 20, losses: 0, matches_played: 20, best_streak: 20, challenges_issued: 99 }),
    ],
    disciplineStats: [],
    metrics: [],
    challenges: [
      { id: 'c1', challenger_id: 'a', challenged_id: 'b', discipline: '8 Ball', status: 'pending', venue: null, created_at: '', expires_at: '' },
      { id: 'c2', challenger_id: 'b', challenged_id: 'a', discipline: '9 Ball', status: 'accepted', venue: null, created_at: '', expires_at: '' },
      { id: 'c3', challenger_id: 'a', challenged_id: 'b', discipline: '9 Ball', status: 'declined', venue: null, created_at: '', expires_at: '' },
    ],
    matches: [
      match('m1'),
      match('m2', { discipline: '9 Ball', venue: 'Lido', completed_at: new Date(NOW - 10 * DAY).toISOString() }),
      match('m3', { status: 'disputed' }),
      match('m4', { status: 'in_progress' }),
    ],
    treasury: { summary: { total_credit_cents: 0, total_debit_cents: 0, balance_cents: 0, entry_count: 0, last_entry_at: null }, entries: [] },
    activity: [],
    ...overrides,
  };
}

test('winPct rounds and guards zero matches', () => {
  assert.equal(winPct(0, 0), 0);
  assert.equal(winPct(2, 3), 67);
  assert.equal(winPct(1, 2), 50);
});

test('only confirmed/resolved matches count as completed', () => {
  const d = deriveLeagueStats(snapshot(), NOW);
  assert.equal(d.completed.length, 2);
  assert.equal(d.disputed.length, 1);
});

test('time windows split completed matches correctly', () => {
  const d = deriveLeagueStats(snapshot(), NOW);
  assert.equal(d.last7, 1);   // m1 (2 days ago); m2 is 10 days ago
  assert.equal(d.last30, 2);
});

test('racks and average race derive from completed matches only', () => {
  const d = deriveLeagueStats(snapshot(), NOW);
  assert.equal(d.racks, 18);        // (6+3) * 2 completed matches
  assert.equal(d.avgRace, '6.0');
});

test('open challenges exclude terminal statuses', () => {
  const d = deriveLeagueStats(snapshot(), NOW);
  assert.equal(d.openChallenges.length, 2); // pending + accepted, not declined
  assert.equal(d.pendingChallenges, 1);
});

test('discipline, venue, and payment breakdowns', () => {
  const d = deriveLeagueStats(snapshot(), NOW);
  const eight = d.byDiscipline.find((x) => x.label === '8 Ball');
  const nine = d.byDiscipline.find((x) => x.label === '9 Ball');
  assert.equal(eight.count, 1);
  assert.equal(nine.count, 1);
  assert.equal(d.byVenue.find((v) => v.label === 'Silver Spur').count, 1);
  assert.equal(d.byVenue.find((v) => v.label === 'Lido').count, 1);
  // every venue from league config is present even with zero matches
  assert.ok(d.byVenue.some((v) => v.label === 'Black Eagle Country Club' && v.count === 0));
  assert.deepEqual(
    Object.fromEntries(d.byPayment.map((p) => [p.label, p.count])),
    { 'Cash envelope': 2, 'Venmo': 2 },
  );
});

test('weekly buckets cover 8 windows and count the recent match', () => {
  const d = deriveLeagueStats(snapshot(), NOW);
  assert.equal(d.weekly.length, 8);
  assert.equal(d.weekly.at(-1).count, 1);  // m1, 2 days ago
  assert.equal(d.weekly.at(-2).count, 1);  // m2, 10 days ago
  assert.equal(d.weekly.reduce((s, w) => s + w.count, 0), 2);
});

test('leaders exclude inactive players', () => {
  const d = deriveLeagueStats(snapshot(), NOW);
  assert.equal(d.leaders.mostMatches.player.id, 'a');   // c has more but is inactive
  assert.equal(d.leaders.bestWinPct.player.id, 'b');    // 90% beats 80%
  assert.equal(d.leaders.bestStreak.player.id, 'a');
  assert.equal(d.leaders.mostChallenges.player.id, 'a');
});

test('player counts and top5 join', () => {
  const d = deriveLeagueStats(snapshot(), NOW);
  assert.equal(d.activePlayers, 2);
  assert.equal(d.totalPlayers, 3);
  assert.equal(d.claimedPlayers, 1);
  assert.equal(d.top5.length, 2);
  assert.equal(d.top5[0].player.full_name, 'Player a');
  assert.equal(d.nameOf('missing-id'), 'Unknown');
});
