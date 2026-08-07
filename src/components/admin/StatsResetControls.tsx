import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';

/**
 * Admin stats reset.
 *
 * Two deliberate modes, because the counters and the visible match history are
 * stored separately:
 *
 *   keepHistory = true   zero the counters, leave Match History listing every
 *                        past match. For fixing a bad stat.
 *   keepHistory = false  zero the counters AND stamp stats_reset_at, so the
 *                        app hides matches completed before the reset. For
 *                        starting the list fresh — otherwise a player sees
 *                        "0 Wins" sitting directly above a list of matches
 *                        they won.
 *
 * Note: this league runs continuously — there are no seasons. Avoid season
 * framing in anything player- or admin-facing. The player_season_stats table
 * name is inherited from upstream and is not renamed.
 *
 * Matches are never deleted. Ladder positions are never touched (admins
 * reorder the ladder directly on the Rankings tab).
 */

export type ResetScope = { playerId: string; playerName: string } | 'league';

/** Invalidate everything that renders a stat, so the UI can't show stale numbers. */
function useStatsInvalidation() {
  const qc = useQueryClient();
  return () => {
    for (const key of [
      'rankings', 'player-discipline-stats', 'player-matches',
      'league-stats', 'admin-stats', 'players',
    ]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
    qc.invalidateQueries({ queryKey: ['stats-reset-events'] });
  };
}

function rpcErrorMessage(error: { code?: string; message?: string } | null): string {
  if (!error) return '';
  if (error.code === 'PGRST202' || error.code === '42883') {
    return 'Reset is not available on this database yet — the migration has not been applied.';
  }
  if (error.message?.includes('admin role required')) {
    return 'You need admin access to reset stats.';
  }
  return error.message ?? 'Could not reset stats.';
}

/** The most recent reset that has not been undone, for the Undo button. */
export function useLastResetEvent() {
  return useQuery({
    queryKey: ['stats-reset-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stats_reset_events')
        .select('id, scope, player_id, kept_history, player_count, created_at, restored_at')
        .is('restored_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        // Table missing (migration not applied) must not break the settings tab.
        if (error.code === '42P01' || error.code === 'PGRST205') return null;
        throw error;
      }
      return data;
    },
    retry: false,
  });
}

type ResetButtonsProps = {
  scope: ResetScope;
  onDone?: () => void;
  onCancel?: () => void;
};

/**
 * The two reset choices plus a typed confirmation. Used inline for a single
 * player and inside the league-wide danger zone.
 */
export function StatsResetButtons({ scope, onDone, onCancel }: ResetButtonsProps) {
  const isLeague = scope === 'league';
  const label = isLeague ? 'the entire league' : scope.playerName;

  const [pending, setPending] = useState<null | boolean>(null); // null | keepHistory
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invalidate = useStatsInvalidation();

  // A league-wide wipe touches 117 records at once, so make it deliberate.
  const needsTypedConfirm = isLeague;
  const confirmed = !needsTypedConfirm || confirmText.trim().toUpperCase() === 'RESET';

  async function run(keepHistory: boolean) {
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('admin_reset_stats', {
      p_player_id: isLeague ? null : scope.playerId,
      p_keep_history: keepHistory,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcErrorMessage(rpcError));
      return;
    }
    invalidate();
    setPending(null);
    setConfirmText('');
    onDone?.();
  }

  if (pending === null) {
    return (
      <div className="space-y-2">
        <button
          onClick={() => setPending(true)}
          className="w-full px-3 py-2 rounded-lg text-xs font-[Barlow] font-medium bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30 text-left"
        >
          Reset stats — keep match history
          <span className="block text-[#9CA3AF] font-normal mt-0.5">
            Wins, losses and streaks go to zero. Past matches stay visible.
          </span>
        </button>
        <button
          onClick={() => setPending(false)}
          className="w-full px-3 py-2 rounded-lg text-xs font-[Barlow] font-medium bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30 text-left"
        >
          Reset stats — hide past matches
          <span className="block text-[#9CA3AF] font-normal mt-0.5">
            Starts the list fresh. Old matches are kept in the records but no
            longer shown on profiles.
          </span>
        </button>
        {onCancel && (
          <Button variant="ghost" size="sm" fullWidth onClick={onCancel}>Cancel</Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[#E8E2D6] text-xs font-[Barlow]">
        Reset stats for <span className="font-semibold">{label}</span>
        {pending ? ', keeping match history' : ' and hide matches played before now'}?
      </p>
      <p className="text-[#9CA3AF] text-xs font-[Barlow]">
        This can be undone from Settings straight afterwards.
      </p>
      {needsTypedConfirm && (
        <input
          autoFocus
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type RESET to confirm"
          className="w-full px-3 py-2 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-sm focus:outline-none focus:border-[var(--toc-theme-accent)]"
        />
      )}
      {error && <p className="text-[#EF4444] text-xs font-[Barlow]">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setPending(null); setConfirmText(''); setError(''); }}
        >
          Back
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={!confirmed}
          onClick={() => run(pending)}
        >
          {busy ? 'Resetting…' : 'Confirm reset'}
        </Button>
      </div>
    </div>
  );
}

/** Danger-zone card for the Settings tab: league-wide reset plus undo. */
export function LeagueStatsResetCard() {
  const [open, setOpen] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const [banner, setBanner] = useState('');
  const [error, setError] = useState('');
  const { data: lastReset } = useLastResetEvent();
  const invalidate = useStatsInvalidation();

  async function undo() {
    if (!lastReset) return;
    setUndoBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('admin_restore_stats', {
      p_event_id: lastReset.id,
    });
    setUndoBusy(false);
    if (rpcError) {
      setError(rpcErrorMessage(rpcError));
      return;
    }
    invalidate();
    setBanner('Stats restored.');
  }

  return (
    <GlassCard className="p-4 border border-[#EF4444]/20">
      <h3 className="font-[Bebas_Neue] text-xl text-[#E8E2D6]">Reset League Stats</h3>
      <p className="text-[#9CA3AF] text-xs font-[Barlow] mt-1 mb-3">
        Zeroes wins, losses, streaks and forfeits for every player. Ladder
        positions are not affected — reorder those on the Rankings tab.
      </p>

      {banner && <p className="text-[#22C55E] text-xs font-[Barlow] mb-2">{banner}</p>}
      {error && <p className="text-[#EF4444] text-xs font-[Barlow] mb-2">{error}</p>}

      {lastReset && (
        <div className="mb-3 p-3 rounded-lg bg-[#252525]/60">
          <p className="text-[#E8E2D6] text-xs font-[Barlow]">
            Last reset: {lastReset.scope === 'league'
              ? `all ${lastReset.player_count} players`
              : 'one player'}
            {lastReset.kept_history ? ', history kept' : ', history hidden'}
            {' · '}
            {new Date(lastReset.created_at).toLocaleString()}
          </p>
          <button
            onClick={undo}
            disabled={undoBusy}
            className="mt-2 px-3 py-1.5 rounded-lg text-xs font-[Barlow] font-medium bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/30 disabled:opacity-60"
          >
            {undoBusy ? 'Restoring…' : 'Undo this reset'}
          </button>
        </div>
      )}

      {open ? (
        <StatsResetButtons
          scope="league"
          onCancel={() => setOpen(false)}
          onDone={() => { setOpen(false); setBanner('League stats reset.'); }}
        />
      ) : (
        <Button variant="secondary" fullWidth onClick={() => setOpen(true)}>
          Reset stats for all players…
        </Button>
      )}
    </GlassCard>
  );
}
