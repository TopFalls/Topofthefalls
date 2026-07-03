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

  if (isError) return <AdminQueryError onRetry={() => refetch()} />;
  if (challenges.length === 0) {
    return <AdminEmpty title="No Active Challenges" subtitle="Nothing pending action." />;
  }

  return (
    <div className="space-y-3">
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
