import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrapList } from '../../lib/supabaseResult';
import { callEdgeFunction, edgeErrorMessage } from '../../lib/edgeFunctions';
import { usePlayerNames } from '../../hooks/usePlayerNames';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';
import { Badge, type BadgeVariant } from '../Badge';
import { formatDistanceToNow, formatDate } from '../../utils/time';
import { AdminEmpty, AdminQueryError, WinnerPicker } from './AdminShared';
import type { Challenge } from '../../types/database';

type ChallengeRow = Challenge & { match_id: string | null };

const STATUS_BADGE: Record<string, BadgeVariant> = {
  pending: 'pending', accepted: 'win', scheduled: 'info', in_progress: 'loss', forfeited: 'loss',
};

export function ChallengesTab() {
  const qc = useQueryClient();
  const { data: challenges = [], isError, refetch } = useQuery<ChallengeRow[]>({
    queryKey: ['admin-active-challenges'],
    queryFn: async () => {
      const chals = unwrapList(await supabase
        .from('challenges')
        .select('*')
        .in('status', ['pending', 'accepted', 'scheduled', 'in_progress', 'forfeited'])
        .order('created_at', { ascending: false }));
      if (chals.length === 0) return [];
      const matches = unwrapList(await supabase
        .from('matches')
        .select('id, challenge_id')
        .in('challenge_id', chals.map((c) => c.id)));
      return chals.map((c) => ({
        ...c,
        match_id: matches.find((m) => m.challenge_id === c.id)?.id ?? null,
      }));
    },
  });

  const { data: forfeitEvents = [] } = useQuery<{ challenge_id: string }[]>({
    queryKey: ['admin-active-forfeiture-events'],
    queryFn: async () => unwrapList(await supabase
      .from('challenge_forfeiture_events')
      .select('challenge_id')
      .is('reversed_at', null)),
  });
  const activeForfeitChallengeIds = new Set(forfeitEvents.map((e) => e.challenge_id));

  const { getName } = usePlayerNames();

  const [actioning, setActioning]   = useState<string | null>(null);
  const [actionType, setActionType] = useState<'cancel' | 'forfeit' | 'reverse_decline' | null>(null);
  const [winnerId, setWinnerId]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [actionError, setActionError] = useState('');

  const resetAction = () => { setActioning(null); setActionType(null); setWinnerId(''); setActionError(''); };

  const invalidateAfterChange = () => {
    qc.invalidateQueries({ queryKey: ['admin-active-challenges'] });
    qc.invalidateQueries({ queryKey: ['admin-active-forfeiture-events'] });
    qc.invalidateQueries({ queryKey: ['rankings'] });
    qc.invalidateQueries({ queryKey: ['challenges'] });
    qc.invalidateQueries({ queryKey: ['activity-feed-full'] });
  };

  const handleReverseDecline = async (c: ChallengeRow) => {
    setLoading(true);
    setActionError('');
    try {
      await callEdgeFunction('respond-to-challenge', { challenge_id: c.id, action: 'reverse_decline' });
      invalidateAfterChange();
      resetAction();
    } catch (err) {
      setActionError(edgeErrorMessage(err, 'Could not reverse this decline.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (c: ChallengeRow) => {
    setLoading(true);
    setActionError('');
    const { error } = await supabase.from('challenges').update({ status: 'cancelled' }).eq('id', c.id);
    setLoading(false);
    if (error) { setActionError(error.message); return; }
    qc.invalidateQueries({ queryKey: ['admin-active-challenges'] });
    resetAction();
  };

  const handleForfeit = async (c: ChallengeRow) => {
    if (!winnerId || !c.match_id) return;
    setLoading(true);
    setActionError('');
    const challengerWon = winnerId === c.challenger_id;
    try {
      await callEdgeFunction('resolve-dispute', {
        match_id: c.match_id,
        winner_id: winnerId,
        final_score_player1: challengerWon ? c.race_length : 0,
        final_score_player2: challengerWon ? 0 : c.race_length,
        notes: 'Admin forfeit',
        force_complete: true,
      });
      const { error } = await supabase.from('challenges').update({ status: 'forfeited' }).eq('id', c.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['admin-active-challenges'] });
      qc.invalidateQueries({ queryKey: ['rankings'] });
      resetAction();
    } catch (err) {
      setActionError(edgeErrorMessage(err, 'Could not apply the forfeit.'));
    } finally {
      setLoading(false);
    }
  };

  // Rule 4: a player says they could not agree on a time, and Carl decides.
  // A wash moves nobody; the challenger sits 24 hrs and the challenged player
  // may challenge up straight away.
  const resolveWash = async (challengeId: string, isWash: boolean) => {
    setLoading(true);
    setActionError('');
    const { error } = await supabase.rpc('admin_resolve_wash', {
      p_challenge_id: challengeId,
      p_is_wash: isWash,
    });
    setLoading(false);
    if (error) {
      setActionError(
        error.code === 'PGRST202' || error.code === '42883'
          ? 'Wash decisions are not available on this database yet.'
          : error.message,
      );
      return;
    }
    qc.invalidateQueries({ queryKey: ['admin-active-challenges'] });
    qc.invalidateQueries({ queryKey: ['admin-alerts'] });
    qc.invalidateQueries({ queryKey: ['rankings'] });
  };

  const washRequests = challenges.filter((c) => c.wash_requested_at);

  if (isError) return <AdminQueryError onRetry={() => refetch()} />;
  if (challenges.length === 0) {
    return <AdminEmpty title="No Active Challenges" subtitle="Nothing pending action." />;
  }

  return (
    <div className="space-y-3">
      {washRequests.length > 0 && (
        <GlassCard className="p-4 border border-[#F59E0B]/30">
          <h3 className="font-[Bebas_Neue] text-xl text-[#E8E2D6]">
            Couldn&apos;t agree on a time ({washRequests.length})
          </h3>
          <p className="text-[#9CA3AF] text-xs font-[Barlow] mt-1 mb-3">
            Your call. A wash moves nobody — the challenger sits 24 hours, and the
            challenged player can challenge up straight away.
          </p>
          {washRequests.map((c) => (
            <div key={c.id} className="p-3 rounded-lg bg-[#252525]/60 mb-2 last:mb-0">
              <div className="text-sm font-[Barlow] text-[#E8E2D6]">
                {getName(c.challenger_id)} vs {getName(c.challenged_id)}
              </div>
              <div className="text-xs text-[#6B7280] font-[Barlow] mt-0.5">
                {c.discipline} · race to {c.race_length} · raised by{' '}
                {getName(c.wash_requested_by ?? '')} {formatDistanceToNow(c.wash_requested_at!)}
              </div>
              <div className="flex gap-2 mt-2">
                <Button variant="ghost" size="sm" disabled={loading} onClick={() => resolveWash(c.id, false)}>
                  Challenge stands
                </Button>
                <Button variant="primary" size="sm" loading={loading} onClick={() => resolveWash(c.id, true)}>
                  Call it a wash
                </Button>
              </div>
            </div>
          ))}
          {actionError && <p className="text-[#EF4444] text-xs font-[Barlow] mt-2">{actionError}</p>}
        </GlassCard>
      )}
      {challenges.map((c) => (
        <GlassCard key={c.id} className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Badge variant={STATUS_BADGE[c.status] ?? 'default'}>{c.status.replace('_', ' ').toUpperCase()}</Badge>
            <span className="text-[#6B7280] text-xs font-[Barlow]">{formatDate(c.created_at)}</span>
          </div>
          <div className="font-[Barlow] font-semibold text-sm text-[#E8E2D6] mb-0.5">
            {getName(c.challenger_id)} → {getName(c.challenged_id)}
          </div>
          <div className="text-[#9CA3AF] text-xs font-[Barlow] mb-3">
            {c.discipline} · Race to {c.race_length} · Expires {formatDistanceToNow(c.expires_at)}
          </div>

          {(() => {
            const declineForfeit = c.status === 'forfeited' && activeForfeitChallengeIds.has(c.id);

            if (actioning === c.id) {
              if (actionType === 'reverse_decline') {
                return (
                  <div className="space-y-3">
                    <p className="text-[#9CA3AF] text-xs font-[Barlow]">
                      Reverse the decline. The challenge returns to pending only if the rankings, stats,
                      cooldown, and challenge row have not been touched since the forfeit.
                    </p>
                    {actionError && <p className="text-[#EF4444] text-xs font-[Barlow]">{actionError}</p>}
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={resetAction}>Back</Button>
                      <Button variant="primary" size="sm" loading={loading} onClick={() => handleReverseDecline(c)}>
                        Reverse Decline
                      </Button>
                    </div>
                  </div>
                );
              }
              return (
                <div className="space-y-3">
                  {actionType === 'forfeit' && (
                    c.match_id ? (
                      <WinnerPicker
                        options={[{ id: c.challenger_id, name: getName(c.challenger_id) }, { id: c.challenged_id, name: getName(c.challenged_id) }]}
                        value={winnerId}
                        onChange={setWinnerId}
                      />
                    ) : (
                      <p className="text-[#F59E0B] text-xs font-[Barlow]">No match started — this will cancel the challenge only.</p>
                    )
                  )}
                  {actionError && <p className="text-[#EF4444] text-xs font-[Barlow]">{actionError}</p>}
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={resetAction}>Back</Button>
                    <Button
                      variant="danger" size="sm" loading={loading}
                      disabled={actionType === 'forfeit' && !!c.match_id && !winnerId}
                      onClick={() => actionType === 'cancel' ? handleCancel(c) : (c.match_id ? handleForfeit(c) : handleCancel(c))}
                    >
                      Confirm
                    </Button>
                  </div>
                </div>
              );
            }

            if (declineForfeit) {
              return (
                <div className="flex gap-2">
                  <Button
                    variant="secondary" size="sm"
                    onClick={() => { setActioning(c.id); setActionType('reverse_decline'); setActionError(''); }}
                  >
                    Reverse Decline
                  </Button>
                </div>
              );
            }

            return (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setActioning(c.id); setActionType('cancel'); setActionError(''); }}>Cancel</Button>
                <Button variant="danger" size="sm" onClick={() => { setActioning(c.id); setActionType('forfeit'); setWinnerId(''); setActionError(''); }}>
                  {c.match_id ? 'Force Forfeit' : 'Force Cancel'}
                </Button>
              </div>
            );
          })()}
        </GlassCard>
      ))}
    </div>
  );
}
