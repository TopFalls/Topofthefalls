import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrapList } from '../../lib/supabaseResult';
import { callEdgeFunction, edgeErrorMessage } from '../../lib/edgeFunctions';
import { usePlayerNames } from '../../hooks/usePlayerNames';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';
import { Badge, type BadgeVariant } from '../Badge';
import { formatDate } from '../../utils/time';
import { AdminEmpty, AdminQueryError, WinnerPicker, adminInputClass } from './AdminShared';
import type { Match } from '../../types/database';

const STATUS_BADGE: Record<string, BadgeVariant> = { scheduled: 'info', in_progress: 'loss', submitted: 'pending' };

export function MatchesAdminTab() {
  const qc = useQueryClient();
  const { data: matches = [], isError, refetch } = useQuery<Match[]>({
    queryKey: ['admin-active-matches'],
    queryFn: async () => unwrapList(await supabase
      .from('matches')
      .select('*')
      .in('status', ['scheduled', 'in_progress', 'submitted'])
      .order('created_at', { ascending: false })),
  });
  const { getName } = usePlayerNames();

  const [resolving, setResolving] = useState<string | null>(null);
  const [winnerId, setWinnerId]   = useState('');
  const [p1Score, setP1Score]     = useState('');
  const [p2Score, setP2Score]     = useState('');
  const [notes, setNotes]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  const handleForceComplete = async (matchId: string) => {
    if (!winnerId) return;
    setLoading(true);
    setError('');
    try {
      await callEdgeFunction('resolve-dispute', {
        match_id: matchId,
        winner_id: winnerId,
        final_score_player1: parseInt(p1Score) || 0,
        final_score_player2: parseInt(p2Score) || 0,
        notes,
        force_complete: true,
      });
      setResolving(null);
      qc.invalidateQueries({ queryKey: ['admin-active-matches'] });
      qc.invalidateQueries({ queryKey: ['rankings'] });
    } catch (err) {
      setError(edgeErrorMessage(err, 'Could not force-complete this match.'));
    } finally {
      setLoading(false);
    }
  };

  if (isError) return <AdminQueryError onRetry={() => refetch()} />;
  if (matches.length === 0) {
    return <AdminEmpty title="No Active Matches" subtitle="Nothing pending action." />;
  }

  return (
    <div className="space-y-3">
      {matches.map((m) => (
        <GlassCard key={m.id} className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Badge variant={STATUS_BADGE[m.status] ?? 'default'}>{m.status.replace('_', ' ').toUpperCase()}</Badge>
            <span className="text-[#6B7280] text-xs font-[Barlow]">{formatDate(m.created_at)}</span>
          </div>
          <div className="font-[Barlow] font-semibold text-sm text-[#E8E2D6] mb-0.5">
            {getName(m.player1_id)} vs {getName(m.player2_id)}
          </div>
          <div className="text-[#9CA3AF] text-xs font-[Barlow] mb-1">Score: {m.player1_score}–{m.player2_score}</div>
          <div className="text-[#9CA3AF] text-xs font-[Barlow] mb-2">{m.discipline} · Race to {m.race_length} · {m.venue}</div>
          {m.player1_submitted && <div className="text-[#F59E0B] text-xs font-[Barlow]">⚠ {getName(m.player1_id)} submitted</div>}
          {m.player2_submitted && <div className="text-[#F59E0B] text-xs font-[Barlow] mb-2">⚠ {getName(m.player2_id)} submitted</div>}

          {resolving === m.id ? (
            <div className="space-y-3 mt-2">
              <WinnerPicker
                options={[{ id: m.player1_id, name: getName(m.player1_id) }, { id: m.player2_id, name: getName(m.player2_id) }]}
                value={winnerId}
                onChange={setWinnerId}
              />
              <div className="grid grid-cols-2 gap-2">
                <input type="number" placeholder={`${getName(m.player1_id)} score`} value={p1Score} onChange={(e) => setP1Score(e.target.value)} className={adminInputClass} />
                <input type="number" placeholder={`${getName(m.player2_id)} score`} value={p2Score} onChange={(e) => setP2Score(e.target.value)} className={adminInputClass} />
              </div>
              <textarea placeholder="Admin notes…" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className={`w-full resize-none ${adminInputClass}`} />
              {error && <p className="text-[#EF4444] text-xs font-[Barlow]">{error}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setResolving(null); setError(''); }}>Cancel</Button>
                <Button variant="primary" size="sm" loading={loading} disabled={!winnerId} onClick={() => handleForceComplete(m.id)}>
                  Force Complete
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" size="sm" onClick={() => { setResolving(m.id); setWinnerId(''); setP1Score(''); setP2Score(''); setNotes(''); setError(''); }}>
              Force Complete
            </Button>
          )}
        </GlassCard>
      ))}
    </div>
  );
}
