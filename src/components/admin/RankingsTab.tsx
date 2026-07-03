import React, { useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrapList } from '../../lib/supabaseResult';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';
import { AdminQueryError } from './AdminShared';

type RankRow = { id: string; player_id: string; position: number; full_name: string };

export function RankingsTab() {
  const qc = useQueryClient();
  const { data: rawRankings = [], isError, refetch } = useQuery<RankRow[]>({
    queryKey: ['admin-rankings'],
    queryFn: async () => {
      const [ranksRes, playersRes] = await Promise.all([
        supabase.from('rankings').select('id, player_id, position').order('position'),
        supabase.from('players').select('id, full_name').eq('is_active', true),
      ]);
      const ranks = unwrapList(ranksRes);
      const pls = unwrapList(playersRes);
      return ranks.map((r) => ({
        ...r,
        full_name: pls.find((p) => p.id === r.player_id)?.full_name ?? 'Unknown',
      }));
    },
  });

  const [order, setOrder]   = useState<RankRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [saveError, setSaveError] = useState('');
  const displayedOrder = order.length > 0 ? order : rawRankings;

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    setOrder((prev) => {
      const next = [...(prev.length > 0 ? prev : rawRankings)];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    if (idx === displayedOrder.length - 1) return;
    setOrder((prev) => {
      const next = [...(prev.length > 0 ? prev : rawRankings)];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const isDirty = displayedOrder.some((r, i) => {
    const original = rawRankings.find((raw) => raw.player_id === r.player_id);
    return original?.position !== i + 1;
  });

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    const payload = displayedOrder.map((r, i) => ({
      player_id: r.player_id,
      position: i + 1,
      previous_position: r.position,
    }));

    // Prefer the atomic RPC (single transaction); fall back to per-row updates
    // when the function has not been deployed to this database yet.
    const { error: rpcError } = await supabase.rpc('admin_reorder_rankings', { p_order: payload });
    if (rpcError) {
      const functionMissing = rpcError.code === 'PGRST202' || rpcError.code === '42883';
      if (!functionMissing) {
        setSaveError(rpcError.message);
        setSaving(false);
        return;
      }
      const results = await Promise.all(
        payload.map((row) =>
          supabase.from('rankings')
            .update({ position: row.position, previous_position: row.previous_position })
            .eq('player_id', row.player_id)
        )
      );
      const firstError = results.find((r) => r.error)?.error;
      if (firstError) {
        setSaveError(`Save may be incomplete — reload before retrying. (${firstError.message})`);
        setSaving(false);
        qc.invalidateQueries({ queryKey: ['admin-rankings'] });
        return;
      }
    }

    setSaving(false);
    setSaved(true);
    setOrder([]);
    setTimeout(() => setSaved(false), 2000);
    qc.invalidateQueries({ queryKey: ['rankings'] });
    qc.invalidateQueries({ queryKey: ['admin-rankings'] });
  };

  if (isError) return <AdminQueryError onRetry={() => refetch()} />;
  if (displayedOrder.length === 0) {
    return <div className="text-center py-12 text-[#6B7280] font-[Barlow]">Loading rankings…</div>;
  }

  return (
    <div className="space-y-3">
      <GlassCard className="p-3">
        <p className="text-[#9CA3AF] text-xs font-[Barlow]">
          Use arrows to reorder players. Changes are staged until you tap Save.
        </p>
      </GlassCard>

      <div className="space-y-1">
        {displayedOrder.map((r, i) => {
          const original = rawRankings.find((raw) => raw.player_id === r.player_id);
          const changed = original?.position !== i + 1;
          return (
            <GlassCard key={r.player_id} className={`p-3 flex items-center gap-3 ${changed ? 'border border-[#F59E0B]/30' : ''}`}>
              <span className="font-[Azeret_Mono] font-bold text-lg text-[var(--toc-theme-accent)] w-7 text-center shrink-0">
                {i + 1}
              </span>
              <span className="font-[Barlow] font-semibold text-sm text-[#E8E2D6] flex-1 truncate">
                {r.full_name}
              </span>
              {changed && (
                <span className="text-[#F59E0B] text-xs font-[Azeret_Mono] shrink-0">
                  was {original?.position}
                </span>
              )}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button onClick={() => moveUp(i)} disabled={i === 0}
                  className="p-1 rounded text-[#9CA3AF] hover:text-[#E8E2D6] disabled:opacity-20 transition-colors">
                  <ArrowUp size={14} />
                </button>
                <button onClick={() => moveDown(i)} disabled={i === displayedOrder.length - 1}
                  className="p-1 rounded text-[#9CA3AF] hover:text-[#E8E2D6] disabled:opacity-20 transition-colors">
                  <ArrowDown size={14} />
                </button>
              </div>
            </GlassCard>
          );
        })}
      </div>

      {saveError && <p className="text-[#EF4444] text-xs font-[Barlow]">{saveError}</p>}
      <div className="flex gap-2 pt-2">
        <Button variant="ghost" fullWidth disabled={!isDirty} onClick={() => { setOrder(rawRankings); setSaveError(''); }}>
          Reset
        </Button>
        <Button variant="primary" fullWidth loading={saving} disabled={!isDirty} onClick={handleSave}>
          {saved ? '✓ Saved' : 'Save Order'}
        </Button>
      </div>
    </div>
  );
}
