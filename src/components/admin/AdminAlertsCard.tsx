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
  player_id: string | null;
  created_at: string;
};

const ALERT_ICON: Record<string, string> = {
  inactive_drift: '⬇️',
  inactive_90_day: '⏳',
  wash_requested: '🤝',
  wash_penalty: '⏱️',
  player_self_deactivated: '💤',
  player_self_activated: '🎱',
};

export function useOpenAdminAlerts() {
  return useQuery<AdminAlert[]>({
    queryKey: ['admin-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_alerts')
        .select('id, alert_type, headline, detail, player_id, created_at')
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
  const [overrideBusy, setOverrideBusy] = React.useState<string | null>(null);
  const [overrideError, setOverrideError] = React.useState('');

  async function dismiss(id: string) {
    await supabase
      .from('admin_alerts')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', id);
    qc.invalidateQueries({ queryKey: ['admin-alerts'] });
  }

  async function overrideWash(alert: AdminAlert, remainingHours: number | null) {
    if (!alert.player_id) return;
    setOverrideBusy(alert.id);
    setOverrideError('');

    const { error } = await supabase.rpc('admin_override_wash_cooldown', {
      p_player_id: alert.player_id,
      p_remaining_hours: remainingHours,
    });

    setOverrideBusy(null);
    if (error) {
      setOverrideError(
        error.code === 'PGRST202' || error.code === '42883'
          ? 'Wash overrides are not available on this database yet.'
          : error.message,
      );
      return;
    }

    qc.invalidateQueries({ queryKey: ['admin-alerts'] });
    qc.invalidateQueries({ queryKey: ['cooldowns'] });
  }

  if (alerts.length === 0) return null;

  return (
    <GlassCard className="p-4 mb-3 border border-[#F59E0B]/25">
      <h3 className="font-[Bebas_Neue] text-xl text-[#E8E2D6]">
        Needs your attention{' '}
        <span style={{ color: 'var(--toc-theme-accent)' }}>({alerts.length})</span>
      </h3>

      {overrideError && (
        <div className="mt-3 text-xs text-[#EF4444] font-[Barlow]">{overrideError}</div>
      )}

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
              {alert.alert_type === 'wash_penalty' && alert.player_id && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    onClick={() => overrideWash(alert, 1)}
                    disabled={overrideBusy === alert.id}
                    className="px-2 py-1 rounded-lg text-[10px] font-[Barlow] font-medium bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30 disabled:opacity-50"
                  >
                    Shorten to 1 hour
                  </button>
                  <button
                    onClick={() => overrideWash(alert, null)}
                    disabled={overrideBusy === alert.id}
                    className="px-2 py-1 rounded-lg text-[10px] font-[Barlow] font-medium bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/30 disabled:opacity-50"
                  >
                    Clear cooldown
                  </button>
                </div>
              )}
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
