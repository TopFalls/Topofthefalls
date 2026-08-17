import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getTopOfTheFallsDemoRankings, isTopOfTheFallsDemoMode } from '../demo/topOfTheFallsDemo';
import type { RankedPlayer, Player, Ranking, PlayerMetrics, PlayerSeasonStats } from '../types/database';

export function useRankings() {
  return useQuery<RankedPlayer[]>({
    queryKey: ['rankings'],
    queryFn: async () => {
      if (isTopOfTheFallsDemoMode()) return getTopOfTheFallsDemoRankings();

      const [playersRes, rankingsRes, metricsRes, statsRes] = await Promise.all([
        // The ladder itself reads the guest-readable views, so this one hook
        // serves signed-in players and signed-out visitors alike. The views
        // return the same rows the tables do — those policies were already
        // open to the whole league — they just pin the column list.
        //
        // Inactive players stay on the list (greyed out, unchallengeable), so
        // they must be fetched too — filtering them out here left holes in the
        // numbering and made their profile page load forever.
        supabase.from('public_players').select('*'),
        supabase.from('public_rankings').select('*').order('position'),
        supabase.from('public_player_metrics').select('*'),
        // Win/loss records are private to the player they belong to, so this
        // one stays on the base table: you get your own row, an admin gets
        // everyone's, and a guest is refused. That refusal is deliberately not
        // fatal below — the list still renders, without records.
        supabase.from('player_season_stats').select('*'),
      ]);

      // Surface fetch failures so pages can show an error state instead of an
      // empty (and misleading) list.
      if (playersRes.error)  throw playersRes.error;
      if (rankingsRes.error) throw rankingsRes.error;

      const players  = (playersRes.data  ?? []) as Player[];
      const rankings = (rankingsRes.data ?? []) as Ranking[];
      const metrics  = (metricsRes.data  ?? []) as PlayerMetrics[];
      const stats    = (statsRes.data    ?? []) as PlayerSeasonStats[];

      return rankings.map((r) => ({
        player:  players.find((p) => p.id === r.player_id)!,
        ranking: r,
        metrics: metrics.find((m) => m.player_id === r.player_id) ?? null,
        stats:   stats.find((s)   => s.player_id === r.player_id) ?? null,
      })).filter((rp) => rp.player);
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
