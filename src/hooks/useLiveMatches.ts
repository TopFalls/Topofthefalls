import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { LiveMatch } from '../types/database';

// Matches being played right now, visible to the whole league instead of only
// the two players at the table.
//
// This reads `public_live_matches`, a view that carries the scoreboard and
// nothing else and drops a match the moment it stops being in progress. The
// `matches` table itself stays private to its two players — widening that
// policy would have exposed payment methods and result submissions along with
// the score.
//
// Polling, not realtime: Postgres row-level security applies to realtime
// subscriptions too, so a change to somebody else's match is never pushed to
// you. Ten seconds is quick enough to watch a race unfold and cheap enough to
// leave running on the home screen.
export function useLiveMatches() {
  return useQuery<LiveMatch[]>({
    queryKey: ['live-matches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('public_live_matches')
        .select('*')
        .order('started_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as LiveMatch[];
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
}
