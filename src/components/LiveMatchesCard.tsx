import React from 'react';
import { motion } from 'framer-motion';
import { Avatar } from './Avatar';
import { GlassCard } from './GlassCard';
import { useLiveMatches } from '../hooks/useLiveMatches';
import type { LiveMatch } from '../types/database';

function Side({
  name,
  avatarUrl,
  score,
  leading,
}: {
  name: string;
  avatarUrl: string | null;
  score: number;
  leading: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
      <Avatar player={{ full_name: name, avatar_url: avatarUrl }} size={38} />
      <span className="text-[11px] font-[Barlow] text-[#9CA3AF] text-center leading-tight truncate max-w-full">
        {name.split(' ')[0]}
      </span>
      <span
        className="font-[Azeret_Mono] font-bold text-3xl leading-none tabular-nums"
        style={{ color: leading ? 'var(--toc-theme-accent-2)' : '#E8E2D6' }}
      >
        {score}
      </span>
    </div>
  );
}

function LiveMatchRow({ m }: { m: LiveMatch }) {
  const target  = m.race_length;
  const leader  = Math.max(m.player1_score, m.player2_score);
  const progress = target > 0 ? Math.min(100, (leader / target) * 100) : 0;

  return (
    <div className="py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center justify-between mb-2 text-[11px] font-[Barlow] text-[#6B7280]">
        <span>
          {m.discipline} · race to {m.race_length}
        </span>
        {m.venue && <span className="truncate max-w-[45%] text-right">{m.venue}</span>}
      </div>

      <div className="flex items-center gap-3">
        <Side
          name={m.player1_name}
          avatarUrl={m.player1_avatar_url}
          score={m.player1_score}
          leading={m.player1_score > m.player2_score}
        />
        <span className="font-[Bebas_Neue] text-lg text-[#4B5563] shrink-0">VS</span>
        <Side
          name={m.player2_name}
          avatarUrl={m.player2_avatar_url}
          score={m.player2_score}
          leading={m.player2_score > m.player1_score}
        />
      </div>

      <div className="mt-2.5 h-1 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'var(--toc-theme-accent)' }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

/**
 * Scores from matches being played right now.
 *
 * Read-only on purpose, and deliberately not tappable: the match screen loads
 * the private `matches` row, so it only opens for the two players actually at
 * the table. They reach it from their own home screen. Everyone else — the
 * rest of the league and any guest — gets the scoreboard and that is all.
 */
export const LiveMatchesCard: React.FC = () => {
  const { data: live = [], isLoading } = useLiveMatches();

  // Nothing on the tables is the normal state most of the week — say so on the
  // guest page rather than leaving a hole, but stay out of the way for players.
  if (isLoading || live.length === 0) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full bg-[#4B5563]" />
          <h2 className="font-[Bebas_Neue] text-xl tracking-wide text-[#9CA3AF]">
            Live Now
          </h2>
        </div>
        <p className="text-[#6B7280] text-sm font-[Barlow]">
          {isLoading ? 'Checking the tables…' : 'No matches being played right now.'}
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <motion.span
          className="w-2 h-2 rounded-full"
          style={{ background: 'var(--toc-theme-accent)' }}
          animate={{ opacity: [1, 0.25, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <h2 className="font-[Bebas_Neue] text-xl tracking-wide text-[#E8E2D6]">
          Live Now
        </h2>
        <span className="text-[#6B7280] text-xs font-[Barlow] ml-auto">
          {live.length} {live.length === 1 ? 'match' : 'matches'}
        </span>
      </div>

      <div>
        {live.map((m) => (
          <LiveMatchRow key={m.id} m={m} />
        ))}
      </div>
    </GlassCard>
  );
};
