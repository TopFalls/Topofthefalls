import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../lib/supabaseResult';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';
import { AdminQueryError } from './AdminShared';
import type { LeagueSettings } from '../../types/database';

type SettingsFormState = {
  min_race: number | '';
  challenge_range: number | '';
  cooldown_hours: number | '';
  challenge_expiry_days: number | '';
  challenge_response_hours: number | '';
  match_play_days: number | '';
  challenge_weekly_limit: number | '';
  first_challenge_range: number | '';
};

const RULE_FIELDS: Array<{ key: keyof SettingsFormState; label: string; unit: string }> = [
  { key: 'min_race', label: 'Min race length', unit: 'games' },
  { key: 'challenge_range', label: 'Challenge range', unit: 'spots (normal)' },
  { key: 'first_challenge_range', label: 'First challenge range', unit: 'spots (first ever)' },
  { key: 'challenge_weekly_limit', label: 'Weekly challenge limit', unit: 'challenges per 7 days' },
  { key: 'challenge_response_hours', label: 'Challenge response window', unit: 'hours to accept/decline' },
  { key: 'match_play_days', label: 'Match play window', unit: 'days after acceptance' },
  { key: 'cooldown_hours', label: 'Post-match cooldown', unit: 'hours after a win' },
  { key: 'challenge_expiry_days', label: 'Challenge expiry', unit: 'days until auto-expire' },
];

type SettingsFieldProps = {
  label: string;
  unit: string;
  value: number | '';
  onChange: (value: number | '') => void;
};

function SettingsField({ label, unit, value, onChange }: SettingsFieldProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div>
        <div className="font-[Barlow] text-sm text-[#E8E2D6]">{label}</div>
        <div className="text-[#6B7280] text-xs font-[Barlow]">{unit}</div>
      </div>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? '' : Number(raw));
        }}
        className="w-20 px-3 py-1.5 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Azeret_Mono] text-sm text-center focus:outline-none focus:border-[var(--toc-theme-accent)]"
      />
    </div>
  );
}

export function SettingsTab() {
  const qc = useQueryClient();
  const { data: settings, isError, refetch } = useQuery<LeagueSettings | null>({
    queryKey: ['league-settings'],
    queryFn: async () => unwrap(await supabase.from('league_settings').select('*').single()),
  });

  const [edits, setEdits] = useState<Partial<SettingsFormState>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (isError) return <AdminQueryError onRetry={() => refetch()} />;
  if (!settings) return <div className="text-center py-12 text-[#6B7280] font-[Barlow]">Loading settings…</div>;

  const form: SettingsFormState = {
    min_race: edits.min_race ?? settings.min_race,
    challenge_range: edits.challenge_range ?? settings.challenge_range,
    cooldown_hours: edits.cooldown_hours ?? settings.cooldown_hours,
    challenge_expiry_days: edits.challenge_expiry_days ?? settings.challenge_expiry_days,
    challenge_response_hours: edits.challenge_response_hours ?? settings.challenge_response_hours,
    match_play_days: edits.match_play_days ?? settings.match_play_days,
    challenge_weekly_limit: edits.challenge_weekly_limit ?? settings.challenge_weekly_limit,
    first_challenge_range: edits.first_challenge_range ?? settings.first_challenge_range,
  };

  const set = (key: keyof SettingsFormState, val: number | '') => {
    setEdits((current) => ({ ...current, [key]: val }));
    setSaved(false);
  };

  const hasBlankField = Object.values(form).some((value) => value === '');
  const isDirty = Object.entries(form).some(([key, value]) => (
    value !== settings[key as keyof SettingsFormState]
  ));

  const handleSave = async () => {
    if (!isDirty || hasBlankField) return;
    if (!window.confirm('Save these league rule changes?')) return;
    setSaving(true);
    setSaveError('');
    const { error } = await supabase.from('league_settings').update(form).eq('id', settings.id);
    setSaving(false);
    if (error) { setSaveError(error.message); return; }
    setEdits({});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    qc.invalidateQueries({ queryKey: ['league-settings'] });
    qc.invalidateQueries({ queryKey: ['admin-league-settings'] });
  };

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <h3 className="font-[Bebas_Neue] text-xl text-[#E8E2D6] mb-1">League Rules</h3>
        {RULE_FIELDS.map((field) => (
          <SettingsField
            key={field.key}
            label={field.label}
            value={form[field.key]}
            onChange={(value) => set(field.key, value)}
            unit={field.unit}
          />
        ))}
      </GlassCard>
      {hasBlankField && (
        <p className="text-[#EF4444] text-xs font-[Barlow] px-1">Fill in every setting before saving.</p>
      )}
      {saveError && <p className="text-[#EF4444] text-xs font-[Barlow] px-1">{saveError}</p>}
      <Button variant="primary" fullWidth loading={saving} disabled={!isDirty || hasBlankField} onClick={handleSave}>
        {saved ? '✓ Saved' : 'Save Settings'}
      </Button>
    </div>
  );
}
