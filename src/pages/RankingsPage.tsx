import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, X, Swords } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRankings } from '../hooks/useRankings';
import { useAuthStore } from '../stores/authStore';
import { Avatar } from '../components/Avatar';
import { GuestBar } from '../components/GuestBar';
import { EKGLine } from '../components/EKGLine';
import { Badge } from '../components/Badge';
import { RankingRowSkeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { QueryError } from '../components/QueryError';
import type { RankedPlayer } from '../types/database';
import {
  activeRankByPosition,
  challengeEligibilityOnLadder,
  canChallengeOnLadder,
  type Eligibility,
} from '../lib/ladder';

function RankCard({
  rp,
  myPosition,
  myPlayerId,
  activeRanks,
  index,
  challengeMode,
  isGuest,
}: {
  rp: RankedPlayer;
  myPosition: number | null;
  myPlayerId: string | null;
  activeRanks: Map<number, number>;
  index: number;
  challengeMode: boolean;
  isGuest: boolean;
}) {
  const navigate = useNavigate();
  const pos       = rp.ranking.position;
  const isMe      = rp.player.id === myPlayerId;
  const isInactive = !rp.player.is_active;
  const isTop3    = pos <= 3 && !isInactive;
  const eligibility: Eligibility = myPosition !== null
    ? challengeEligibilityOnLadder(myPosition, pos, activeRanks)
    : { ok: false };
  const eligible  = eligibility.ok && !isMe;
  // In challenge mode, explain why ineligible opponents can't be challenged.
  const showReason = challengeMode && myPosition !== null && !isMe && !eligible;
  const rankChange = rp.ranking.previous_position !== null
    ? rp.ranking.previous_position - pos  // positive = moved up
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.025, duration: 0.3, ease: 'easeOut' }}
    >
      <div
        className={[
          'glass-card p-3 flex items-center gap-3',
          // A player's page shows their record, which is theirs alone. Guests
          // get the list, not the people on it, so the row is inert for them.
          isGuest ? '' : 'cursor-pointer',
          'transition-all duration-200',
          isTop3 ? 'gold-shimmer' : '',
          // Inactive players hold their spot but are visibly stood down.
          isInactive ? 'opacity-55 grayscale' : '',
          showReason && !isInactive ? 'opacity-50' : '',
        ].join(' ')}
        style={isMe ? { borderColor: 'var(--toc-theme-border-strong)', boxShadow: '0 0 16px var(--toc-theme-glow-soft)' } : undefined}
        onClick={isGuest ? undefined : () => navigate(`/player/${rp.player.id}`)}
      >
        {/* Rank number */}
        <div className="w-8 text-center shrink-0">
          <span
            className="font-[Azeret_Mono] font-bold text-lg"
            style={{
              color: isInactive
                ? '#4B5563'
                : pos === 1 ? '#D4AF37' : pos === 2 ? '#9CA3AF' : pos === 3 ? '#CD7F32' : '#6B7280',
            }}
          >
            {pos}
          </span>
        </div>

        {/* Avatar */}
        <Avatar player={rp.player} size={44} />

        {/* Name + info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-[Barlow] font-semibold text-base truncate ${isInactive ? 'text-[#9CA3AF]' : 'text-[#E8E2D6]'}`}>
              {rp.player.full_name}
            </span>
            {isMe && <Badge variant="info" className="shrink-0">You</Badge>}
            {isInactive && <Badge variant="warning" className="shrink-0 text-[10px]">Inactive</Badge>}
            {!rp.player.profile_id && <Badge variant="default" className="shrink-0 text-[10px]">Unclaimed</Badge>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[#6B7280] text-xs font-[Azeret_Mono]">
              {rp.metrics?.fargo_rating ?? 'Unrated'}
              {rp.metrics?.fargo_rating ? ' FR' : ''}
            </span>
            {/* Records are private to the player they belong to. RLS returns
                only your own stats row, so this renders for you alone. */}
            {isMe && rp.stats && (
              <span
                className="text-[#6B7280] text-xs font-[Azeret_Mono]"
                title="Wins · Losses · Forfeits"
              >
                {rp.stats.wins}-{rp.stats.losses}-{rp.stats.forfeits}
              </span>
            )}
            {rankChange !== 0 && (
              <span className={`text-xs font-[Azeret_Mono] ${rankChange > 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                {rankChange > 0 ? `↑${rankChange}` : `↓${Math.abs(rankChange)}`}
              </span>
            )}
          </div>
        </div>

        {/* Challenge button */}
        {(challengeMode || eligible) && eligible && (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={(e) => { e.stopPropagation(); navigate(`/challenge/${rp.player.id}`); }}
            className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg border text-xs font-[Barlow] font-semibold transition-colors min-h-[40px]"
            style={{
              backgroundColor: 'var(--toc-theme-glow-soft)',
              borderColor: 'var(--toc-theme-border-strong)',
              color: 'var(--toc-theme-accent-2)',
            }}
          >
            <Swords size={12} />
            Challenge
          </motion.button>
        )}

        {/* Why this opponent can't be challenged (challenge mode only) */}
        {showReason && eligibility.reason && (
          <span className="shrink-0 text-[10px] font-[Barlow] text-[#6B7280] text-right max-w-[92px] leading-tight">
            {eligibility.reason}
          </span>
        )}
      </div>
    </motion.div>
  );
}

export default function RankingsPage() {
  const { data: rankings = [], isLoading, isError, refetch } = useRankings();
  const { player, session } = useAuthStore();
  const isGuest = !session;
  const [search, setSearch]   = useState('');
  const [tab, setTab]         = useState<'all' | 'near'>('all');
  const [searchParams]        = useSearchParams();
  const challengeMode         = searchParams.get('challenge') === '1';

  const myRanking = rankings.find((r) => r.player.id === player?.id);
  const myPosition = myRanking?.ranking.position ?? null;

  // Inactive players keep their spot on screen but are stepped over by the
  // challenge rules, so eligibility is judged on rank among active players.
  const activeRanks = useMemo(
    () => activeRankByPosition(
      rankings.map((r) => ({ position: r.ranking.position, isActive: r.player.is_active })),
    ),
    [rankings],
  );

  const inactiveCount = rankings.length - activeRanks.size;

  const filtered = useMemo(() => {
    let list = rankings;
    if (search) list = list.filter((r) => r.player.full_name.toLowerCase().includes(search.toLowerCase()));
    if (tab === 'near' && myPosition !== null) {
      list = list.filter((r) =>
        canChallengeOnLadder(myPosition, r.ranking.position, activeRanks) && r.player.id !== player?.id
      );
    }
    return list;
  }, [rankings, search, tab, myPosition, player?.id, activeRanks]);

  return (
    <div className={`min-h-screen px-4 pb-4 ${isGuest ? 'pt-3' : 'pt-8'}`}>
      {isGuest && <GuestBar />}

      {/* Header */}
      <div className="text-center mb-6">
        <h1
          className="font-[Bebas_Neue] text-6xl tracking-wide"
          style={{ textShadow: '0 0 30px var(--toc-theme-glow)' }}
        >
          The List
        </h1>
        <EKGLine className="mx-auto mt-1" />
        <p className="text-[#9CA3AF] text-xs font-[Barlow] mt-2">
          {rankings.length} players · Challenge List
          {inactiveCount > 0 && ` · ${inactiveCount} inactive`}
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players…"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-[#1A1A1A] border border-[#333] text-[#E8E2D6] font-[Barlow] text-sm focus:outline-none focus:border-[var(--toc-theme-accent)] transition-colors"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X size={14} className="text-[#6B7280]" />
          </button>
        )}
      </div>

      {/* Tabs */}
      {player && (
        <div className="flex gap-2 mb-4">
          {(['all', 'near'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-4 py-2 rounded-full text-sm font-[Barlow] font-medium transition-all',
                tab === t
                  ? 'text-white'
                  : 'bg-[#1A1A1A] text-[#9CA3AF] border border-[#333]',
              ].join(' ')}
              style={tab === t ? { backgroundColor: 'var(--toc-theme-accent)' } : {}}
            >
              {t === 'all' ? 'All Players' : 'Can Challenge'}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {isLoading
          ? Array.from({ length: 10 }).map((_, i) => <RankingRowSkeleton key={i} />)
          : isError
          ? <QueryError onRetry={() => refetch()} />
          : filtered.length === 0
          ? <EmptyState
              title="No Players Found"
              message={search ? `No one matches "${search}"` : 'The table is empty. Check back soon!'}
              icon="🎱"
            />
          : filtered.map((rp, i) => (
              <RankCard
                key={rp.player.id}
                rp={rp}
                myPosition={myPosition}
                myPlayerId={player?.id ?? null}
                activeRanks={activeRanks}
                index={i}
                challengeMode={challengeMode}
                isGuest={isGuest}
              />
            ))
        }
      </div>
    </div>
  );
}
