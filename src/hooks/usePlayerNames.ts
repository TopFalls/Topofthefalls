import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { unwrapList } from '../lib/supabaseResult';

export type PlayerNameRow = { id: string; full_name: string };

/**
 * Shared id → name lookup (query key 'players-lookup' is reused across admin
 * tabs, so the list is fetched once per staleTime regardless of tab count).
 */
export function usePlayerNames() {
  const query = useQuery<PlayerNameRow[]>({
    queryKey: ['players-lookup'],
    queryFn: async () => unwrapList(await supabase.from('players').select('id, full_name')),
    staleTime: 60_000,
  });
  const players = query.data ?? [];
  const getName = (id: string | null | undefined): string => {
    if (!id) return 'Unknown';
    return players.find((p) => p.id === id)?.full_name ?? id.slice(0, 8) + '…';
  };
  return { ...query, players, getName };
}
