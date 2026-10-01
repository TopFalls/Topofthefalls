import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Does the app currently move the list by itself?
 *
 * `league_settings.automatic_list_changes` is the testing-period switch. While
 * it is off, an unanswered challenge, a decline and an inactive stretch only
 * alert the admin, so the screens must not promise a forfeit.
 *
 * This fails toward the STRICT wording: unless the setting is known to be off,
 * the screens keep warning that a decline counts as a forfeit. Telling a
 * player "nothing changes" when something might is the worse mistake. The
 * server makes the opposite choice for the same reason (an unreadable setting
 * means no automatic change), so a failed read can only ever over-warn.
 */
export function useAutomaticListChanges(): boolean {
  const { data } = useQuery<boolean | null>({
    queryKey: ['automatic-list-changes'],
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from('league_settings')
        .select('automatic_list_changes')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return row ? row.automatic_list_changes : null;
    },
    staleTime: 60_000,
  });
  return data !== false;
}
