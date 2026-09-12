import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { activeChallengeCooldown, mayIssueChallenge, type CooldownWindow } from '../lib/challengeCooldown';
import { isTopOfTheFallsDemoMode } from '../demo/topOfTheFallsDemo';

export function useChallengeCooldown() {
  const { player } = useAuthStore();
  const [now, setNow] = useState(Date.now);
  const query = useQuery<CooldownWindow[]>({
    queryKey: ['cooldowns', player?.id],
    enabled: !!player,
    queryFn: async () => {
      if (isTopOfTheFallsDemoMode()) return [];
      const { data, error } = await supabase.from('cooldowns')
        .select('type, expires_at').eq('player_id', player!.id)
        .gt('expires_at', new Date().toISOString());
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 15_000,
    retry: 1,
  });
  // Refresh the local clock so a displayed wait ends without reloading the page.
  useEffect(() => {
    if (!query.data?.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [query.data]);
  const cooldown = activeChallengeCooldown(query.data ?? [], Math.max(now, Date.now()));
  return {
    canIssue: mayIssueChallenge(!!player && player.is_active, query.isSuccess, query.isError, cooldown),
    cooldown,
    isLoading: !!player && query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  };
}
