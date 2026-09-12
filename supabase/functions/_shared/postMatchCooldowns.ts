import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const CHALLENGE_LOSS_WAIT_HOURS = 168;

/** Called for completed matches only, never on acceptance or scheduling. */
export async function applyPostMatchCooldowns(
  supabase: SupabaseClient,
  loserId: string,
  winnerId: string,
  winnerMovedUp: boolean,
  defenderId: string,
  completedAt = new Date().toISOString(),
): Promise<void> {
  const { data: settings, error: settingsError } = await supabase
    .from('league_settings').select('cooldown_hours').single();
  if (settingsError) throw settingsError;
  const winHours = settings?.cooldown_hours ?? 24;
  const at = (hours: number) => new Date(Date.parse(completedAt) + hours * 3600_000).toISOString();
  const rows: { player_id: string; type: string; expires_at: string }[] = [];

  // Any match loss starts a fresh seven-day wait, including a lost defence.
  rows.push({ player_id: loserId, type: 'post_match', expires_at: at(CHALLENGE_LOSS_WAIT_HOURS) });
  if (winnerMovedUp && winnerId !== defenderId && winHours > 0) {
    rows.push({ player_id: winnerId, type: 'post_match', expires_at: at(winHours) });
  }
  if (rows.length) {
    const { error } = await supabase.from('cooldowns').insert(rows);
    if (error) throw error;
  }
  const { error } = await supabase.from('cooldowns').delete()
    .eq('player_id', defenderId)
    // Only a winning defence clears post-match waits. The separate returning-
    // player rule still clears reentry on completing a defence, win or lose.
    .in('type', winnerId === defenderId ? ['post_match', 'reentry'] : ['reentry'])
    .lte('created_at', completedAt);
  if (error) throw error;
}
