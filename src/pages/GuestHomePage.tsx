import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useRankings } from '../hooks/useRankings';
import { GuestBar } from '../components/GuestBar';
import { LiveMatchesCard } from '../components/LiveMatchesCard';
import { GlassCard } from '../components/GlassCard';
import { Avatar } from '../components/Avatar';
import { EKGLine } from '../components/EKGLine';
import { LeagueRulesCard } from '../components/LeagueRulesCard';
import { LEAGUE } from '../config/league';
import { formatDistanceToNow } from '../utils/time';
import type { PublicActivityFeedItem } from '../types/database';

/**
 * What a visitor sees before they have an account.
 *
 * Everything here is read-only and comes from the guest views: the top of the
 * list, live scores, and the league feed. No challenges, no records, no
 * treasury — a guest cannot reach any of that, in the database or in the UI.
 */
export default function GuestHomePage() {
  const navigate = useNavigate();
  const { data: rankings = [], isLoading: rankingsLoading } = useRankings();

  const { data: feed = [] } = useQuery<PublicActivityFeedItem[]>({
    queryKey: ['guest-activity'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('public_activity_feed')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as PublicActivityFeedItem[];
    },
  });

  const topFive = rankings.slice(0, 5);
  const activeCount = rankings.filter((r) => r.player.is_active).length;

  return (
    <div className="min-h-screen px-4 pt-3 pb-10">
      <GuestBar />

      {/* Masthead */}
      <div className="text-center mb-6">
        <h1
          className="font-[Bebas_Neue] text-5xl tracking-wide text-[#E8E2D6] leading-none"
          style={{ textShadow: '0 0 30px var(--toc-theme-glow)' }}
        >
          {LEAGUE.name}
        </h1>
        <EKGLine className="mx-auto mt-1" />
        <p className="text-[#9CA3AF] text-sm font-[Barlow] mt-2">{LEAGUE.tagline}</p>
        <p className="text-[#6B7280] text-xs font-[Barlow] mt-1">
          {LEAGUE.region}
          {rankings.length > 0 && ` · ${rankings.length} players · ${activeCount} active`}
        </p>
      </div>

      <div className="space-y-4">
        {/* Live scores — the reason to keep the page open on league night */}
        <LiveMatchesCard />

        {/* Top of the list */}
        <GlassCard className="p-4">
          <div className="flex items-center mb-3">
            <h2 className="font-[Bebas_Neue] text-xl tracking-wide text-[#E8E2D6]">
              Top of the List
            </h2>
            <button
              onClick={() => navigate('/rankings')}
              className="ml-auto text-xs font-[Barlow] font-medium"
              style={{ color: 'var(--toc-theme-accent-2)' }}
            >
              See all
            </button>
          </div>

          {rankingsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-12 rounded-lg" />
              ))}
            </div>
          ) : topFive.length === 0 ? (
            <p className="text-[#6B7280] text-sm font-[Barlow] py-4">
              The list isn't up yet. Check back soon.
            </p>
          ) : (
            <div className="space-y-0">
              {topFive.map((rp, i) => (
                <motion.div
                  key={rp.player.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0"
                >
                  <span
                    className="w-6 text-center font-[Azeret_Mono] font-bold text-base shrink-0"
                    style={{
                      color:
                        rp.ranking.position === 1 ? '#D4AF37'
                        : rp.ranking.position === 2 ? '#9CA3AF'
                        : rp.ranking.position === 3 ? '#CD7F32'
                        : '#6B7280',
                    }}
                  >
                    {rp.ranking.position}
                  </span>
                  <Avatar player={rp.player} size={34} />
                  <span className="font-[Barlow] font-semibold text-sm text-[#E8E2D6] truncate">
                    {rp.player.full_name}
                  </span>
                </motion.div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* League feed */}
        <GlassCard className="p-4">
          <div className="flex items-center mb-3">
            <h2 className="font-[Bebas_Neue] text-xl tracking-wide text-[#E8E2D6]">
              League Activity
            </h2>
            <button
              onClick={() => navigate('/activity')}
              className="ml-auto text-xs font-[Barlow] font-medium"
              style={{ color: 'var(--toc-theme-accent-2)' }}
            >
              See all
            </button>
          </div>

          {feed.length === 0 ? (
            <p className="text-[#6B7280] text-sm font-[Barlow] py-2">
              Nothing has happened yet.
            </p>
          ) : (
            <div className="space-y-0">
              {feed.map((item) => (
                <div
                  key={item.id}
                  className="py-2 border-b border-white/5 last:border-0"
                >
                  <div className="text-sm font-[Barlow] text-[#E8E2D6] leading-snug">
                    {item.headline}
                  </div>
                  <div className="text-[#6B7280] text-xs font-[Barlow] mt-0.5">
                    {formatDistanceToNow(item.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* How the league works */}
        <LeagueRulesCard />

        {/* The way in */}
        <GlassCard className="p-5 text-center">
          <h2 className="font-[Bebas_Neue] text-2xl tracking-wide text-[#E8E2D6] mb-1">
            Already on the list?
          </h2>
          <p className="text-[#9CA3AF] text-sm font-[Barlow] mb-4">
            Sign in with your email to claim your name, issue challenges and keep
            your own record.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="w-full py-3 rounded-xl font-[Barlow] font-semibold text-white"
            style={{ background: 'var(--toc-theme-accent)' }}
          >
            Sign in
          </button>
          <p className="text-[#6B7280] text-xs font-[Barlow] mt-3">
            Not on the list? Talk to {LEAGUE.contact} at any of the{' '}
            {LEAGUE.sponsorBars.length} league bars.
          </p>
        </GlassCard>
      </div>
    </div>
  );
}
