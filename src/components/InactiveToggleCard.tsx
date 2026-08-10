import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { GlassCard } from './GlassCard';
import { Button } from './Button';
import type { Player } from '../types/database';

/**
 * "Players may go inactive at any time."
 *
 * Going inactive holds your spot but starts the clock: two spots for every 30
 * days out, and a review at 90 days. Coming back you must defend or wait
 * before challenging up — 7 days, or 24 hours if you are last on the list.
 * set_own_active applies all of that; nothing here decides policy.
 */
export function InactiveToggleCard() {
  const { player, setPlayer } = useAuthStore();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');

  if (!player) return null;
  const isActive = player.is_active;

  async function apply(nextActive: boolean) {
    setBusy(true);
    setError('');
    setBanner('');

    const { data, error: rpcError } = await supabase.rpc('set_own_active', { p_is_active: nextActive });
    setBusy(false);
    setConfirming(false);

    if (rpcError) {
      setError(
        rpcError.code === 'PGRST202' || rpcError.code === '42883'
          ? 'This is not available on the app yet — try again after the next update.'
          : rpcError.message,
      );
      return;
    }

    const { data: fresh } = await supabase.from('players').select('*').eq('id', player!.id).single();
    if (fresh) setPlayer(fresh as Player);
    qc.invalidateQueries({ queryKey: ['rankings'] });

    const waitHours = (data as { reentry_wait_hours?: number } | null)?.reentry_wait_hours;
    setBanner(
      nextActive
        ? waitHours
          ? `You're back on the list. Defend your spot, or wait ${waitHours === 24 ? '24 hours' : '7 days'} before challenging up.`
          : "You're back on the list."
        : 'You are now inactive. Nobody can challenge you, and you keep your spot for now.',
    );
  }

  return (
    <GlassCard className="p-5">
      <h2 className="font-[Bebas_Neue] text-2xl text-[#E8E2D6]">Availability</h2>
      <p className="text-[#9CA3AF] text-sm font-[Barlow] mt-1">
        {isActive
          ? 'You are active and can be challenged.'
          : 'You are inactive. Nobody can challenge you.'}
      </p>

      {banner && <p className="text-[#22C55E] text-xs font-[Barlow] mt-3">{banner}</p>}
      {error && <p className="text-[#EF4444] text-xs font-[Barlow] mt-3">{error}</p>}

      {isActive ? (
        confirming ? (
          <div className="mt-4 space-y-2">
            <p className="text-[#E8E2D6] text-sm font-[Barlow]">Go inactive?</p>
            <ul className="text-[#9CA3AF] text-xs font-[Barlow] list-disc pl-5 space-y-1">
              <li>You keep your spot, marked inactive for everyone to see.</li>
              <li>Nobody can challenge you, and you cannot challenge.</li>
              <li>After 30 days you drop two spots, and two more every 30 days after.</li>
              <li>Coming back, you must defend or wait 7 days before challenging up.</li>
            </ul>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={busy} onClick={() => apply(false)}>
                Go inactive
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" fullWidth className="mt-4" onClick={() => setConfirming(true)}>
            Go inactive
          </Button>
        )
      ) : (
        <Button variant="primary" fullWidth className="mt-4" loading={busy} onClick={() => apply(true)}>
          Come back to the list
        </Button>
      )}
    </GlassCard>
  );
}
