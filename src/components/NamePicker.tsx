import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type PickedPlayer = { id: string; full_name: string };

/**
 * Find your name on the league list. Names are public (the guest pages show
 * them), so this works before anyone is signed in. Picking from the list instead
 * of typing means no misspelt names and nothing to guess.
 */
export function NamePicker({
  value,
  onChange,
  label = 'Your name on the list',
}: {
  value: PickedPlayer | null;
  onChange: (player: PickedPlayer | null) => void;
  label?: string;
}) {
  const [search, setSearch] = useState('');
  const { data: players = [], isLoading, isError } = useQuery({
    queryKey: ['login-name-list'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('public_players').select('id, full_name').order('full_name');
      if (error) throw error;
      return (data ?? []) as PickedPlayer[];
    },
  });

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return players.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 6);
  }, [players, search]);

  if (value) {
    return (
      <div>
        <div className="block text-[#9CA3AF] text-sm font-[Barlow] mb-2">{label}</div>
        <div className="flex items-center justify-between rounded-lg bg-[#252525] border border-[var(--toc-theme-accent)] px-4 py-3">
          <span className="font-[Barlow] font-semibold text-[#E8E2D6]">{value.full_name}</span>
          <button
            type="button"
            onClick={() => { onChange(null); setSearch(''); }}
            aria-label="Pick a different name"
            className="text-[#9CA3AF] hover:text-[#E8E2D6]"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="name-search" className="block text-[#9CA3AF] text-sm font-[Barlow] mb-2">{label}</label>
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
        <input
          id="name-search"
          type="text"
          autoComplete="off"
          autoCapitalize="words"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Start typing your name…"
          className="w-full pl-10 pr-4 py-3 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] font-[Barlow] text-base placeholder-[#6B7280] focus:outline-none focus:border-[var(--toc-theme-accent)] focus:ring-1 focus:ring-[var(--toc-theme-glow-soft)] transition-colors"
        />
      </div>
      {isLoading && <p className="text-[#6B7280] text-sm font-[Barlow] mt-2">Loading the list…</p>}
      {isError && <p className="text-[#EF4444] text-sm font-[Barlow] mt-2">Could not load the list. Check your connection.</p>}
      {matches.length > 0 && (
        <ul className="mt-2 rounded-lg border border-[#333] bg-[#1A1A1A] overflow-hidden">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onChange(p)}
                className="w-full text-left px-4 py-3 font-[Barlow] text-[#E8E2D6] hover:bg-white/5 border-b border-white/5 last:border-b-0"
              >
                {p.full_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.trim() && !isLoading && matches.length === 0 && (
        <p className="text-[#9CA3AF] text-sm font-[Barlow] mt-2">
          No one by that name. Not on the list? Ask a league admin to add you.
        </p>
      )}
    </div>
  );
}
