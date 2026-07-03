import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, AlertTriangle, Users, DollarSign, Settings, FileText,
  Trophy, Swords, List, BarChart3, type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { Badge } from '../components/Badge';
import { DisputesTab } from '../components/admin/DisputesTab';
import { ChallengesTab } from '../components/admin/ChallengesTab';
import { MatchesAdminTab } from '../components/admin/MatchesAdminTab';
import { RankingsTab } from '../components/admin/RankingsTab';
import { PlayersTab } from '../components/admin/PlayersTab';
import { TreasuryTab } from '../components/admin/TreasuryTab';
import { SettingsTab } from '../components/admin/SettingsTab';
import { AuditTab } from '../components/admin/AuditTab';

type TabKey = 'disputes' | 'challenges' | 'matches' | 'rankings' | 'players' | 'treasury' | 'settings' | 'audit';

const TABS: { key: TabKey; Icon: LucideIcon; label: string }[] = [
  { key: 'disputes',   Icon: AlertTriangle, label: 'Disputes'   },
  { key: 'challenges', Icon: Swords,        label: 'Challenges' },
  { key: 'matches',    Icon: Trophy,        label: 'Matches'    },
  { key: 'rankings',   Icon: List,          label: 'Rankings'   },
  { key: 'players',    Icon: Users,         label: 'Players'    },
  { key: 'treasury',   Icon: DollarSign,    label: 'Treasury'   },
  { key: 'settings',   Icon: Settings,      label: 'Settings'   },
  { key: 'audit',      Icon: FileText,      label: 'Audit'      },
];

export default function AdminPage() {
  const { profile } = useAuthStore();
  const navigate    = useNavigate();
  const [tab, setTab] = useState<TabKey>('disputes');

  if (!profile) return null;
  if (!['admin', 'super_admin'].includes(profile.role)) {
    navigate('/', { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen px-4 pt-4 pb-8">
      <button onClick={() => navigate('/')} className="flex items-center gap-1 text-[#9CA3AF] p-2 -ml-2 mb-4">
        <ChevronLeft size={18} /> Back
      </button>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">🛡️</span>
        <h1 className="font-[Bebas_Neue] text-5xl text-[#E8E2D6]">Admin</h1>
        <Badge variant="info">{profile?.role}</Badge>
      </div>
      <p className="text-[#9CA3AF] text-sm font-[Barlow] mb-6">League management — handle with care.</p>

      {/* League stats dashboard link */}
      <button
        onClick={() => navigate('/admin/stats')}
        className="w-full mb-4 glass-card glass-card-hover p-3.5 flex items-center gap-3 text-left"
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(198,40,40,0.18)' }}>
          <BarChart3 size={18} className="text-[var(--toc-theme-accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[#E8E2D6] font-[Barlow] font-semibold text-sm">League Stats Dashboard</div>
          <div className="text-[#6B7280] text-xs font-[Barlow]">Live overview — players, matches, venues, payments</div>
        </div>
        <ChevronRight size={16} className="text-[#6B7280] shrink-0" />
      </button>

      {/* Tabs — horizontal scroll */}
      <div className="flex overflow-x-auto gap-1 mb-5 bg-[#1A1A1A] rounded-xl p-1" style={{ scrollbarWidth: 'none' }}>
        {TABS.map(({ key, Icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-col items-center py-2 px-3 rounded-lg text-xs font-[Barlow] transition-all whitespace-nowrap shrink-0 ${tab === key ? 'bg-[var(--toc-theme-accent)] text-white' : 'text-[#9CA3AF]'}`}
          >
            <Icon size={16} className="mb-0.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'disputes'   && <DisputesTab />}
      {tab === 'challenges' && <ChallengesTab />}
      {tab === 'matches'    && <MatchesAdminTab />}
      {tab === 'rankings'   && <RankingsTab />}
      {tab === 'players'    && <PlayersTab />}
      {tab === 'treasury'   && <TreasuryTab />}
      {tab === 'settings'   && <SettingsTab />}
      {tab === 'audit'      && <AuditTab />}
    </div>
  );
}
