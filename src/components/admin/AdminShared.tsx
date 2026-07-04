import React from 'react';
import { QueryError } from '../QueryError';

/** "Nothing needs attention" state used by several admin tabs. */
export function AdminEmpty({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="text-center py-12">
      <div className="text-4xl mb-3">✅</div>
      <div className="font-[Bebas_Neue] text-2xl text-[#E8E2D6]">{title}</div>
      <div className="text-[#9CA3AF] text-sm font-[Barlow] mt-1">{subtitle}</div>
    </div>
  );
}

/** Failed-fetch state for admin tabs — a fetch error must never read as "all clear". */
export function AdminQueryError({ onRetry }: { onRetry: () => void }) {
  return <QueryError title="Couldn't load admin data" onRetry={onRetry} />;
}

/** Two-button winner selector used by disputes, force-complete, and forfeits. */
export function WinnerPicker({ options, value, onChange }: {
  options: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-[#9CA3AF] text-xs font-[Barlow] mb-2">Select winner:</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((p) => (
          <button
            key={p.id}
            onClick={() => onChange(p.id)}
            className={`py-3 px-2 rounded-xl border text-sm font-[Barlow] font-medium transition-all ${value === p.id ? 'border-[#22C55E] bg-[#22C55E]/10 text-[#22C55E]' : 'border-[#333] bg-[#252525]/50 text-[#E8E2D6]'}`}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export const adminInputClass =
  'px-3 py-2 rounded-lg bg-[#252525] border border-[#333] text-[#E8E2D6] text-xs font-[Barlow] focus:outline-none focus:border-[var(--toc-theme-accent)]';
