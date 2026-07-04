import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrapList } from '../../lib/supabaseResult';
import { callEdgeFunction, edgeErrorMessage } from '../../lib/edgeFunctions';
import { usePlayerNames } from '../../hooks/usePlayerNames';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';
import { Badge } from '../Badge';
import { formatDate } from '../../utils/time';
import { AdminEmpty, AdminQueryError, WinnerPicker, adminInputClass } from './AdminShared';
import type { Match } from '../../types/database';

export function DisputesTab() {
  const qc = useQueryClient();
  const { data: disputes = [], isError, refetch } = useQuery<Match[]>({
    queryKey: ['admin-disputes'],
    queryFn: async () => unwrapList(await supabase.from('matches').select('*').eq('status', 'disputed')),
  });
  const { getName } = usePlayerNames();

  const [resolving, setResolving] = useState<string | null>(null);
  const [winnerId, setWinnerId]   = useState('');
  const [p1Score, setP1Score]     = useState('');
  const [p2Score, setP2Score]     = useState('');
  const [notes, setNotes]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  const handleResolve = async (matchId: string) => {
    const s1 = parseInt(p1Score, 10);
    const s2 = parseInt(p2Score, 10);
    if (!winnerId || isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) return;
    setLoading(true);
    setError('');
    try {
      await callEdgeFunction('resolve-dispute', {
        match_id: matchId,
        winner_id: winnerId,
        final_score_player1: s1,
        final_score_player2: s2,
        notes,
      });
      setResolving(null);
      qc.invalidateQueries({ queryKey: ['admin-disputes'] });
      qc.invalidateQueries({ queryKey: ['rankings'] });
    } catch (err) {
      setError(edgeErrorMessage(err, 'Could not resolve this dispute.'));
    } finally {
      setLoading(false);
    }
  };

  if (isError) return <AdminQueryError onRetry={() => refetch()} />;
  if (disputes.length === 0) {
    return <AdminEmpty title="No Disputed Matches" subtitle="All matches are resolved." />;
  }

  return (
    <div className="space-y-3">
      {disputes.map((m) => (
        <GlassCard key={m.id} className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Badge variant="loss">DISPUTED</Badge>
            <span className="text-[#6B7280] text-xs font-[Barlow]">{formatDate(m.created_at)}</span>
          </div>
          <div className="text-[#E8E2D6] font-[Barlow] text-sm font-semibold mb-0.5">
            {getName(m.player1_id)} vs {getName(m.player2_id)}
          </div>
          <div className="text-[#E8E2D6] font-[Barlow] text-sm mb-1">Score: {m.player1_score}–{m.player2_score}</div>
          <div className="text-[#9CA3AF] text-xs font-[Barlow] mb-3">{m.discipline} · Race to {m.race_length} · {m.venue}</div>
          {resolving === m.id ? (
            <div className="space-y-3">
              <WinnerPicker
                options={[{ id: m.player1_id, name: getName(m.player1_id) }, { id: m.player2_id, name: getName(m.player2_id) }]}
                value={winnerId}
                onChange={setWinnerId}
              />
              <div className="grid grid-cols-2 gap-2">
                <input type="number" placeholder="P1 score" value={p1Score} onChange={(e) => setP1Score(e.target.value)} className={adminInputClass} />
                <input type="number" placeholder="P2 score" value={p2Score} onChange={(e) => setP2Score(e.target.value)} className={adminInputClass} />
              </div>
              <textarea placeholder="Admin notes…" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                className={`w-full resize-none ${adminInputClass}`} />
              {error && <p className="text-[#EF4444] text-xs font-[Barlow]">{error}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setResolving(null); setError(''); }}>Cancel</Button>
                <Button variant="primary" size="sm" loading={loading} disabled={!winnerId} onClick={() => handleResolve(m.id)}>Resolve</Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" size="sm" onClick={() => { setResolving(m.id); setWinnerId(''); setP1Score(''); setP2Score(''); setNotes(''); setError(''); }}>
              Resolve Dispute
            </Button>
          )}
        </GlassCard>
      ))}
    </div>
  );
}
