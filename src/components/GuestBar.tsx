import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LEAGUE } from '../config/league';

const LINKS = [
  { label: 'Home',     path: '/' },
  { label: 'The List', path: '/rankings' },
  { label: 'Activity', path: '/activity' },
];

/**
 * Top bar for someone who is just looking around.
 *
 * Guests have no bottom nav — that is built for a player with challenges and
 * alerts — so this is how they move between the three screens they can see,
 * and it keeps the way in visible on every one of them.
 */
export const GuestBar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="sticky top-0 z-40 -mx-4 px-4 py-2.5 mb-4 backdrop-blur-xl border-b border-white/5 bg-[rgba(10,8,8,0.88)]">
      <div className="flex items-center gap-3">
        <span className="font-[Bebas_Neue] tracking-widest text-sm text-[#6B7280] uppercase shrink-0">
          {LEAGUE.shortName}
        </span>

        <div className="flex gap-1 min-w-0">
          {LINKS.map((l) => {
            const active = location.pathname === l.path;
            return (
              <button
                key={l.path}
                onClick={() => navigate(l.path)}
                className="px-2.5 py-1 rounded-lg text-xs font-[Barlow] font-medium transition-colors shrink-0"
                style={{
                  background: active ? 'var(--toc-theme-glow-soft)' : 'transparent',
                  color: active ? 'var(--toc-theme-accent-2)' : '#9CA3AF',
                }}
              >
                {l.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => navigate('/login')}
          className="ml-auto shrink-0 px-3 py-1.5 rounded-lg text-xs font-[Barlow] font-semibold text-white"
          style={{ background: 'var(--toc-theme-accent)' }}
        >
          Sign in
        </button>
      </div>
    </div>
  );
};
