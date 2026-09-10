import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { isTopOfTheFallsDemoMode } from '../demo/topOfTheFallsDemo';
import type { PlayerProtection } from '../types/database';

/**
 * Who cannot be challenged right now, and why.
 *
 * The open-player rule gives a challenger a shield while their own challenge is
 * live, and create-challenge refuses anyone who goes after a shielded player.
 * Until this hook existed the ladder had no idea, so it drew a Challenge button
 * on a protected player and the refusal only arrived after the challenger had
 * filled in the whole form.
 *
 * The predicate is NOT reimplemented here. It lives once in
 * `protected_player_ids()` — the same function create-challenge asks — because a
 * second copy in TypeScript is exactly how this app's rules have drifted before.
 * The refusal wording comes back with it, so the sentence on screen is the
 * sentence the server would have sent.
 *
 * This fails OPEN on purpose. If the call errors, the map is empty, the button
 * appears, and a challenger who taps it gets the old behaviour — a refusal at
 * submit. That is safe precisely because the server still enforces the rule
 * independently; failing closed here would block legitimate challenges over a
 * dropped request, which is the worse mistake. The server fails closed, this
 * fails open, and between them nobody is either misled or wrongly stopped.
 */
export function useProtectedPlayers(enabled = true) {
  return useQuery<Map<string, PlayerProtection>>({
    queryKey: ['protected-players'],
    queryFn: async () => {
      if (isTopOfTheFallsDemoMode()) return new Map();

      const { data, error } = await supabase.rpc('protected_player_ids');
      if (error) throw error;

      const rows = (data ?? []) as PlayerProtection[];
      return new Map(rows.map((row) => [row.player_id, row]));
    },
    // Signed-out visitors cannot challenge anybody and `anon` has no EXECUTE
    // grant on the function, so never ask on their behalf.
    enabled,
    // Protection turns over as challenges are issued, accepted and played.
    // Matched to useRankings, which is what the ladder screen renders beside.
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}
