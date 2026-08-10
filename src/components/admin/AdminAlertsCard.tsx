import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { GlassCard } from '../GlassCard';
import { formatDateTime } from '../../utils/time';

/**
 * Carl is notified, and decides.
 *
 * Inactivity drift is applied automatically, but every drop raises an alert
 * here so an exception can be put back on the Rankings tab. The 90-day review
 * and wash requests land here too. Carl has no player row, so notifications —
 * which key off player_id — cannot reach him.
 */

type AdminAlert = {
  id: string;
  alert_type: string;
  headline: string;
  detail: string | null;
  created_at: string;
};

const ALERT_ICON: Record<string, string> = {
  inactive_drift: '⬇️',
  inactive_90_day: '⏳',
  wash_requested: '🤝',
  player_self_deactivated: '💤',
  player_self_activated: '🎱',
};

export function useOpenAdminAlerts() {
  return useQuery<AdminAlert[]>({
    queryKey: ['admin-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_alerts')
        .select('id, alert_type, headline, detail, created_at')
        .is('acknowledged_at', null)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) {
        // Table missing (migration not applied) must not break the admin page.
        if (error.code === '42P01' || error.code === 'PGRST205') return [];
        throw error;
      }
      return (data ?? []) as AdminAlert[];
    },
    retry: false,
    refetchInterval: 60_000,
  });
}

export function AdminAlertsCard() {
  const qc = useQueryClient();
  const { data: alerts = [] } = useOpenAdminAlerts();

  async function dismiss(id: string) {
    await supabase
      .from('admin_alerts')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', id);
    qc.invalidateQueries({ queryKey: ['admin-alerts'] });
  }

  if (alerts.length === 0) return null;

  return (
    <GlassCard className="p-4 mb-3 border border-[#F59E0B]/25">
      <h3 className="font-[Bebas_Neue] text-xl text-[#E8E2D6]">
        Needs your attention{' '}
        <span style={{ color: 'var(--toc-theme-accent)' }}>({alerts.length})</span>
      </h3>

      <div className="space-y-2 mt-3">
        {alerts.map((alert) => (
          <div key={alert.id} className="flex items-start gap-2 p-3 rounded-lg bg-[#252525]/60">
            <span className="text-base leading-none pt-0.5 shrink-0">
              {ALERT_ICON[alert.alert_type] ?? '•'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-[Barlow] font-medium text-[#E8E2D6]">{alert.headline}</div>
              {alert.detail && (
                <div className="text-xs text-[#9CA3AF] font-[Barlow] mt-0.5">{alert.detail}</div>
              )}
              <div className="text-[10px] text-[#6B7280] font-[Barlow] mt-1">
                {formatDateTime(alert.created_at)}
              </div>
            </div>
            <button
              onClick={() => dismiss(alert.id)}
              className="shrink-0 px-2 py-1 rounded-lg text-[10px] font-[Barlow] font-medium bg-[#333]/60 text-[#9CA3AF] border border-[#333]"
            >
              Done
            </button>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
