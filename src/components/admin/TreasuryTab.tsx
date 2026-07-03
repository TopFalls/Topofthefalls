import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';
import { formatDate } from '../../utils/time';
import { fetchTreasurySnapshot, formatCents, ledgerSignFor } from '../../lib/treasury';
import { callEdgeFunction, edgeErrorMessage } from '../../lib/edgeFunctions';
import { AdminQueryError } from './AdminShared';

export function TreasuryTab() {
  const qc = useQueryClient();
  const [entryType, setEntryType] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount]       = useState('');
  const [desc, setDesc]           = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  const { data, isError, refetch } = useQuery({
    queryKey: ['treasury'],
    queryFn: () => fetchTreasurySnapshot(),
  });

  const summary = data?.summary;
  const entries = data?.entries ?? [];
  const balance = summary?.balance_cents ?? 0;

  const handleAdd = async () => {
    if (!amount || !desc) return;
    setLoading(true);
    setError('');
    try {
      await callEdgeFunction('manage-treasury', {
        entry_type: entryType,
        amount_cents: Math.round(parseFloat(amount) * 100),
        description: desc,
      });
      setAmount('');
      setDesc('');
      qc.invalidateQueries({ queryKey: ['treasury'] });
      qc.invalidateQueries({ queryKey: ['audit-events'] });
    } catch (err) {
      setError(edgeErrorMessage(err, 'Could not save treasury entry.'));
    } finally {
      setLoading(false);
    }
  };

  if (isError) return <AdminQueryError onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 text-center">
        <div className="text-[#9CA3AF] text-sm font-[Barlow] mb-1">Current Balance</div>
        <div className="font-[Azeret_Mono] font-bold text-5xl" style={{ color: balance >= 0 ? '#22C55E' : '#EF4444' }}>
          {formatCents(Math.abs(balance))}
        </div>
        {balance < 0 && <div className="text-[#EF4444] text-xs font-[Barlow] mt-1">In deficit</div>}
        <div className="text-[#6B7280] text-xs font-[Barlow] mt-2">
          {formatCents(summary?.total_credit_cents ?? 0)} in · {formatCents(summary?.total_debit_cents ?? 0)} out · {summary?.entry_count ?? 0} entries
        </div>
      </GlassCard>

      <GlassCard className="p-4">
        <h3 className="font-[Bebas_Neue] text-xl text-[#E8E2D6] mb-3">Add Entry</h3>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(['credit', 'debit'] as const).map((t) => (
              <button key={t} onClick={() => setEntryType(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-[Barlow] font-medium transition-all ${entryType === t ? (t === 'credit' ? 'bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/40' : 'bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/40') : 'bg-[#252525] text-[#9CA3AF] border border-[#333]'}`}>
                {t === 'credit' ? '+ Credit' : '- Debit'}
              </button>
            ))}
          </div>
          <input type="number" step="0.01" placeholder="Amount ($)" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-sm focus:outline-none focus:border-[var(--toc-theme-accent)]" />
          <input placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-sm focus:outline-none focus:border-[var(--toc-theme-accent)]" />
          {error && <p className="text-[#EF4444] text-xs font-[Barlow]">{error}</p>}
          <Button variant="primary" fullWidth loading={loading} onClick={handleAdd} disabled={!amount || !desc}>Add Entry</Button>
        </div>
      </GlassCard>

      <div className="space-y-2">
        {entries.map((entry) => {
          const sign = ledgerSignFor(entry.effect_cents);
          const color = entry.effect_cents > 0
            ? '#22C55E'
            : entry.effect_cents < 0
              ? '#EF4444'
              : '#9CA3AF';
          return (
            <GlassCard key={entry.id} className="p-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-[Barlow] text-sm text-[#E8E2D6] truncate">{entry.description}</div>
                <div className="text-[#6B7280] text-xs font-[Barlow]">{formatDate(entry.created_at)}</div>
              </div>
              <div className="font-[Azeret_Mono] font-bold shrink-0" style={{ color }}>
                {sign}{formatCents(Math.abs(entry.effect_cents))}
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}
