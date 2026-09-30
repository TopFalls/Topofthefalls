import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';

/**
 * The players this account follows. Works for anyone signed in, including a
 * visitor who has not claimed a name; signed-out visitors follow nothing.
 */
export function useFollows() {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const queryClient = useQueryClient();
  const key = ['follows', userId];

  const { data } = useQuery<string[]>({
    queryKey: key,
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('player_follows').select('player_id');
      if (error) throw error;
      return (data ?? []).map((r: { player_id: string }) => r.player_id);
    },
  });

  const followed = useMemo(() => new Set(data ?? []), [data]);

  const toggle = useMutation({
    mutationFn: async ({ playerId, follow }: { playerId: string; follow: boolean }) => {
      if (!userId) throw new Error('Sign in to follow players.');
      const { error } = follow
        ? await supabase.from('player_follows').upsert(
            { profile_id: userId, player_id: playerId },
            { onConflict: 'profile_id,player_id', ignoreDuplicates: true },
          )
        : await supabase.from('player_follows').delete()
            .eq('profile_id', userId).eq('player_id', playerId);
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return {
    followed,
    isSignedIn: !!userId,
    toggle: (playerId: string) => toggle.mutate({ playerId, follow: !followed.has(playerId) }),
    isPending: toggle.isPending,
  };
}
