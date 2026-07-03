import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrapList } from '../../lib/supabaseResult';
import { GlassCard } from '../GlassCard';
import { formatDistanceToNow } from '../../utils/time';
import { AdminQueryError } from './AdminShared';
import type { AuditEvent } from '../../types/database';

export function AuditTab() {
  const { data: events = [], isError, refetch } = useQuery<AuditEvent[]>({
    queryKey: ['audit-events'],
    queryFn: async () => unwrapList(await supabase
      .from('audit_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30)),
  });

  if (isError) return <AdminQueryError onRetry={() => refetch()} />;
  if (events.length === 0) return <div className="text-center py-12 text-[#6B7280] font-[Barlow]">No audit events yet.</div>;

  return (
    <div className="space-y-2">
      {events.map((e) => (
        <GlassCard key={e.id} className="p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-[Barlow] font-semibold text-sm text-[#E8E2D6]">{e.action}</span>
            <span className="text-[#6B7280] text-xs font-[Barlow]">{formatDistanceToNow(e.created_at)}</span>
          </div>
          {e.target_type && (
            <div className="text-[#9CA3AF] text-xs font-[Barlow]">{e.target_type}: {e.target_id?.slice(0, 8)}…</div>
          )}
        </GlassCard>
      ))}
    </div>
  );
}
