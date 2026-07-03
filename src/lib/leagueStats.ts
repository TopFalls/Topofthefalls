import { LEAGUE } from '../config/league';
import { paymentMethodLabel, type PaymentMethod } from './paymentMethods';
import type { LeagueStatsSnapshot, StatsMatch, StatsPlayer } from '../hooks/useLeagueStats';
import type { PlayerSeasonStats, Ranking } from '../types/database';

export const COMPLETED_STATUSES = ['confirmed', 'resolved'];
export const OPEN_CHALLENGE_STATUSES = ['pending', 'accepted', 'scheduled', 'in_progress'];
export const WEEK_MS = 7 * 86400000;
const DISCIPLINES = LEAGUE.disciplines.map((d) => d.value);

export const winPct = (wins: number, played: number) =>
  played > 0 ? Math.round((wins / played) * 100) : 0;

export type LeagueDerived = ReturnType<typeof deriveLeagueStats>;

/**
 * All dashboard aggregates, derived from one snapshot. Pure so it can be
 * unit-tested; `asOf` pins "now" (callers pass the snapshot's fetch time).
 */
export function deriveLeagueStats(data: LeagueStatsSnapshot, asOf: number) {
  const playerById = new Map<string, StatsPlayer>(data.players.map((p) => [p.id, p]));
  const nameOf = (id: string | null | undefined) =>
    (id && playerById.get(id)?.full_name) || 'Unknown';

  const completed = data.matches
    .filter((m) => COMPLETED_STATUSES.includes(m.status))
    .sort((a, b) => new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime());

  const now = asOf;
  const completedAt = (m: StatsMatch) => new Date(m.completed_at ?? m.created_at).getTime();
  const last7 = completed.filter((m) => now - completedAt(m) <= WEEK_MS).length;
  const last30 = completed.filter((m) => now - completedAt(m) <= 30 * 86400000).length;

  const racks = completed.reduce((sum, m) => sum + m.player1_score + m.player2_score, 0);
  const avgRace = completed.length > 0
    ? (completed.reduce((s, m) => s + m.race_length, 0) / completed.length).toFixed(1)
    : '—';

  const disputed = data.matches.filter((m) => m.status === 'disputed');
  const openChallenges = data.challenges.filter((c) => OPEN_CHALLENGE_STATUSES.includes(c.status));
  const pendingChallenges = openChallenges.filter((c) => c.status === 'pending').length;

  // Per-discipline / per-venue / payment-method match counts
  const byDiscipline = DISCIPLINES.map((d) => ({
    label: d,
    count: completed.filter((m) => m.discipline === d).length,
    racks: completed.filter((m) => m.discipline === d).reduce((s, m) => s + m.player1_score + m.player2_score, 0),
  }));
  const venueNames = [...new Set([...LEAGUE.sponsorBars, ...completed.map((m) => m.venue).filter(Boolean)])];
  const byVenue = venueNames
    .map((v) => ({ label: v, count: completed.filter((m) => m.venue === v).length }))
    .sort((a, b) => b.count - a.count);
  const payCounts = new Map<PaymentMethod, number>();
  for (const m of completed) {
    for (const method of [m.player1_payment_method, m.player2_payment_method]) {
      if (method) payCounts.set(method, (payCounts.get(method) ?? 0) + 1);
    }
  }
  const byPayment = [...payCounts.entries()]
    .map(([method, count]) => ({ label: paymentMethodLabel(method), count }))
    .sort((a, b) => b.count - a.count);

  // Weekly trend — last 8 seven-day windows, oldest first
  const weekly: { label: string; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const end = now - i * WEEK_MS;
    const start = end - WEEK_MS;
    weekly.push({
      label: new Date(start).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      count: completed.filter((m) => completedAt(m) > start && completedAt(m) <= end).length,
    });
  }

  const statsFor = (id: string) => data.seasonStats.find((s) => s.player_id === id) ?? null;
  const top5: { ranking: Ranking; player: StatsPlayer | null; stats: PlayerSeasonStats | null }[] =
    data.rankings.slice(0, 5).map((r) => ({
      ranking: r,
      player: playerById.get(r.player_id) ?? null,
      stats: statsFor(r.player_id),
    })).filter((r) => r.player);

  // League leaders
  const withStats = data.seasonStats
    .filter((s) => playerById.get(s.player_id)?.is_active)
    .map((s) => ({ stats: s, player: playerById.get(s.player_id)! }));
  const leaders = {
    mostMatches: [...withStats].sort((a, b) => b.stats.matches_played - a.stats.matches_played)[0] ?? null,
    bestWinPct: [...withStats]
      .filter((x) => x.stats.matches_played >= 3)
      .sort((a, b) => winPct(b.stats.wins, b.stats.matches_played) - winPct(a.stats.wins, a.stats.matches_played))[0] ?? null,
    bestStreak: [...withStats].sort((a, b) => b.stats.best_streak - a.stats.best_streak)[0] ?? null,
    mostChallenges: [...withStats].sort((a, b) => b.stats.challenges_issued - a.stats.challenges_issued)[0] ?? null,
  };

  return {
    playerById, nameOf, completed, disputed, openChallenges, pendingChallenges,
    last7, last30, racks, avgRace, byDiscipline, byVenue, byPayment, weekly, top5, leaders,
    activePlayers: data.players.filter((p) => p.is_active).length,
    claimedPlayers: data.players.filter((p) => p.profile_id).length,
    totalPlayers: data.players.length,
  };
}
