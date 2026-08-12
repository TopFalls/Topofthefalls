import React, { useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrapList } from '../../lib/supabaseResult';
import { callEdgeFunction, edgeErrorMessage } from '../../lib/edgeFunctions';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';
import { AdminQueryError } from './AdminShared';
import { StatsResetButtons } from './StatsResetControls';
import type { Player } from '../../types/database';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PlayersTab() {
  const qc = useQueryClient();
  // Which player's stats-reset panel is expanded, if any.
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetBanner, setResetBanner] = useState('');
  const { data: players = [], isError, refetch } = useQuery<Player[]>({
    queryKey: ['admin-players'],
    queryFn: async () => unwrapList(await supabase.from('players').select('*').order('full_name')),
  });

  // Metrics lookup for Fargo ratings
  const playerIds = useMemo(() => players.map((p) => p.id), [players]);
  const { data: metrics = [] } = useQuery<{ player_id: string; fargo_rating: number | null }[]>({
    queryKey: ['admin-player-metrics', playerIds],
    enabled: playerIds.length > 0,
    queryFn: async () => unwrapList(await supabase
      .from('player_reference_metrics')
      .select('player_id, fargo_rating')
      .in('player_id', playerIds)),
  });
  const fargoByPlayer = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const m of metrics) map.set(m.player_id, m.fargo_rating);
    return map;
  }, [metrics]);

  // Filters: All / Claimed / Unclaimed
  const [filter, setFilter] = useState<'all' | 'claimed' | 'unclaimed'>('all');
  const filteredPlayers = useMemo(() => {
    if (filter === 'claimed') return players.filter((p) => p.profile_id);
    if (filter === 'unclaimed') return players.filter((p) => !p.profile_id);
    return players;
  }, [players, filter]);

  const [adding, setAdding]         = useState(false);
  const [newName, setNewName]       = useState('');
  const [newFargo, setNewFargo]     = useState('');
  const [newEmail, setNewEmail]     = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError]     = useState('');
  const [addBanner, setAddBanner]   = useState('');
  // The player was added but the invite email did not go out — not a failure.
  const [addWarning, setAddWarning] = useState('');
  const [activeToggling, setActiveToggling] = useState<string | null>(null);
  const [activeError, setActiveError] = useState('');
  const [invitingId, setInvitingId]   = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteBanner, setInviteBanner] = useState('');

  const toggleActive = async (p: Player) => {
    setActiveToggling(p.id);
    setActiveError('');
    try {
      await callEdgeFunction('set-player-active', { player_id: p.id, is_active: !p.is_active });
      qc.invalidateQueries({ queryKey: ['admin-players'] });
      qc.invalidateQueries({ queryKey: ['audit-events'] });
    } catch (err) {
      setActiveError(edgeErrorMessage(err, 'Could not update player status.'));
    } finally {
      setActiveToggling(null);
    }
  };

  const handleAddPlayer = async () => {
    if (!newName.trim()) return;
    setAddLoading(true);
    setAddError('');
    setAddBanner('');
    setAddWarning('');

    const payload: { full_name: string; fargo_rating?: number; email?: string } = { full_name: newName.trim() };
    const trimmedFargo = newFargo.trim();
    if (trimmedFargo !== '') {
      const numeric = Number(trimmedFargo);
      if (!/^\d+$/.test(trimmedFargo) || !Number.isSafeInteger(numeric) || numeric < 0) {
        setAddError('Fargo rating must be a non-negative whole number.');
        setAddLoading(false);
        return;
      }
      payload.fargo_rating = numeric;
    }
    const trimmedEmail = newEmail.trim();
    if (trimmedEmail !== '') {
      if (!EMAIL_RE.test(trimmedEmail)) {
        setAddError('Email must be a valid address.');
        setAddLoading(false);
        return;
      }
      payload.email = trimmedEmail;
    }

    try {
      const json = await callEdgeFunction<{
        message?: string;
        ranking_position?: number;
        invite_warning?: string | null;
      }>('add-player', payload);
      if (json.invite_warning) {
        setAddWarning(json.message ?? `Added ${newName.trim()} at #${json.ranking_position}, but the invite email did not go out.`);
      } else {
        setAddBanner(json.message ?? `Added ${newName.trim()} at #${json.ranking_position}.`);
      }
      setNewName('');
      setNewFargo('');
      setNewEmail('');
      setAdding(false);
      qc.invalidateQueries({ queryKey: ['admin-players'] });
      qc.invalidateQueries({ queryKey: ['admin-player-metrics'] });
      qc.invalidateQueries({ queryKey: ['rankings'] });
      qc.invalidateQueries({ queryKey: ['audit-events'] });
      qc.invalidateQueries({ queryKey: ['activity-feed-full'] });
    } catch (err) {
      setAddError(edgeErrorMessage(err, 'Could not add the player.'));
    } finally {
      setAddLoading(false);
    }
  };

  const handleInvite = async (player: Player) => {
    const trimmedEmail = inviteEmail.trim();
    if (!trimmedEmail) { setInviteError('Email is required.'); return; }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setInviteError('Email must be a valid address.');
      return;
    }
    setInviteLoading(true);
    setInviteError('');
    setInviteBanner('');
    try {
      const json = await callEdgeFunction<{ message?: string }>('add-player', { player_id: player.id, email: trimmedEmail });
      setInviteBanner(json.message ?? `Invite sent to ${trimmedEmail}.`);
      setInvitingId(null);
      setInviteEmail('');
      qc.invalidateQueries({ queryKey: ['admin-players'] });
      qc.invalidateQueries({ queryKey: ['audit-events'] });
      qc.invalidateQueries({ queryKey: ['activity-feed-full'] });
    } catch (err) {
      setInviteError(edgeErrorMessage(err, 'Could not send invite.'));
    } finally {
      setInviteLoading(false);
    }
  };

  if (isError) return <AdminQueryError onRetry={() => refetch()} />;

  return (
    <div className="space-y-3">
      {adding ? (
        <GlassCard className="p-4">
          <h3 className="font-[Bebas_Neue] text-lg text-[#E8E2D6] mb-3">Add New Player</h3>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
            className="w-full px-3 py-2.5 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-sm focus:outline-none focus:border-[var(--toc-theme-accent)] mb-2" />
          <input type="number" min={0} step={1} inputMode="numeric" value={newFargo} onChange={(e) => setNewFargo(e.target.value)} placeholder="Fargo rating (optional)"
            onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
            className="w-full px-3 py-2.5 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-sm focus:outline-none focus:border-[var(--toc-theme-accent)] mb-2" />
          <input type="email" inputMode="email" autoComplete="off" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email (optional — sends invite)"
            onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
            className="w-full px-3 py-2.5 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-sm focus:outline-none focus:border-[var(--toc-theme-accent)] mb-1" />
          <p className="text-[#6B7280] text-xs font-[Barlow] mb-3">
            Leave blank to add as unclaimed. With an email we also try to send an invite — if it
            doesn't go out, the player is still added and you can invite them later.
          </p>
          {addError && <p className="text-[#EF4444] text-xs font-[Barlow] mb-2">{addError}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setNewName(''); setNewFargo(''); setNewEmail(''); setAddError(''); }}>Cancel</Button>
            <Button variant="primary" size="sm" loading={addLoading} disabled={!newName.trim()} onClick={handleAddPlayer}>
              {newEmail.trim() !== '' ? 'Add & Invite' : 'Add Player'}
            </Button>
          </div>
        </GlassCard>
      ) : (
        <Button variant="secondary" fullWidth onClick={() => setAdding(true)}>
          <UserPlus size={16} /> Add New Player
        </Button>
      )}

      {addBanner && <p className="text-[#22C55E] text-xs font-[Barlow]">{addBanner}</p>}
      {addWarning && <p className="text-[#F59E0B] text-xs font-[Barlow]">{addWarning}</p>}
      {inviteBanner && <p className="text-[#22C55E] text-xs font-[Barlow]">{inviteBanner}</p>}
      {activeError && <p className="text-[#EF4444] text-xs font-[Barlow]">{activeError}</p>}

      {/* Filter buttons */}
      <div className="flex gap-2">
        {(['all', 'claimed', 'unclaimed'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 py-2 rounded-lg text-xs font-[Barlow] font-medium transition-all ${filter === f ? 'bg-[var(--toc-theme-accent)] text-white' : 'bg-[#252525] text-[#9CA3AF] border border-[#333]'}`}>
            {f === 'all' ? 'All' : f === 'claimed' ? 'Claimed' : 'Unclaimed'}
          </button>
        ))}
      </div>

      {resetBanner && (
        <p className="text-[#22C55E] text-xs font-[Barlow]">
          {resetBanner} Undo is available on the Settings tab.
        </p>
      )}

      <p className="text-[#9CA3AF] text-xs font-[Barlow]">{filteredPlayers.length} {filter === 'all' ? 'total' : filter} players</p>
      {filteredPlayers.map((p) => {
        const fr = fargoByPlayer.get(p.id);
        const isInviting = invitingId === p.id;
        const isResetting = resettingId === p.id;
        return (
          <GlassCard key={p.id} className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className={`font-[Barlow] font-semibold text-sm truncate ${p.is_active ? 'text-[#E8E2D6]' : 'text-[#6B7280] line-through'}`}>
                  {p.full_name}
                  {typeof fr === 'number' && (
                    <span className="ml-2 text-[#9CA3AF] font-normal">FR {fr}</span>
                  )}
                </div>
                <div className="text-[#6B7280] text-xs font-[Barlow]">{p.profile_id ? 'Claimed' : 'Unclaimed'}</div>
              </div>
              {!p.profile_id && !isInviting && (
                <button
                  onClick={() => { setInvitingId(p.id); setInviteEmail(''); setInviteError(''); setInviteBanner(''); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-[Barlow] font-medium transition-colors bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30">
                  Invite
                </button>
              )}
              {!isResetting && (
                <button
                  onClick={() => { setResettingId(p.id); setResetBanner(''); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-[Barlow] font-medium transition-colors bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30">
                  Stats
                </button>
              )}
              <button onClick={() => toggleActive(p)} disabled={activeToggling === p.id}
                className={`px-3 py-1.5 rounded-lg text-xs font-[Barlow] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${p.is_active ? 'bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/30' : 'bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/30'}`}>
                {activeToggling === p.id ? 'Saving…' : p.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
            {isResetting && (
              <div className="mt-3">
                <StatsResetButtons
                  scope={{ playerId: p.id, playerName: p.full_name }}
                  onCancel={() => setResettingId(null)}
                  onDone={() => { setResettingId(null); setResetBanner(`${p.full_name}'s stats were reset.`); }}
                />
              </div>
            )}
            {isInviting && (
              <div className="mt-3 space-y-2">
                <input
                  type="email"
                  inputMode="email"
                  autoFocus
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); setInviteError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite(p)}
                  placeholder={`Email for ${p.full_name}`}
                  className="w-full px-3 py-2 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-sm focus:outline-none focus:border-[var(--toc-theme-accent)]"
                />
                {inviteError && <p className="text-[#EF4444] text-xs font-[Barlow]">{inviteError}</p>}
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setInvitingId(null); setInviteEmail(''); setInviteError(''); }}>Cancel</Button>
                  <Button variant="primary" size="sm" loading={inviteLoading} disabled={!inviteEmail.trim()} onClick={() => handleInvite(p)}>Send Invite</Button>
                </div>
              </div>
            )}
          </GlassCard>
        );
      })}
    </div>
  );
}
