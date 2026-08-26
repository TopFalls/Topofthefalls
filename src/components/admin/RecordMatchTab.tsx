import React, { useMemo, useState } from 'react';
import { ClipboardPen } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { callEdgeFunction, edgeErrorMessage } from '../../lib/edgeFunctions';
import { useRankings } from '../../hooks/useRankings';
import { GlassCard } from '../GlassCard';
import { Button } from '../Button';
import { adminInputClass } from './AdminShared';
import { LEAGUE } from '../../config/league';

/**
 * Enter a result for players who do not use the app (questionnaire K3).
 *
 * Carl: "Leave them on the list I will enter there results myself." Not every
 * one of the 119 has email, and they still play. This records the match as if
 * the two players had confirmed it themselves — same ladder swap, same stats,
 * same cooldowns — because the server runs the identical code path.
 */
export function RecordMatchTab() {
  const { data: rankings = [] } = useRankings();
  const qc = useQueryClient();

  const [challengerId, setChallengerId] = useState('');
  const [challengedId, setChallengedId] = useState('');
  const [discipline, setDiscipline]     = useState<string>(LEAGUE.disciplines[0].value);
  const [raceLength, setRaceLength]     = useState(String(LEAGUE.minRace));
  const [venue, setVenue]               = useState<string>(LEAGUE.sponsorBars[0]);
  const [scoreChallenger, setScoreChallenger] = useState('');
  const [scoreChallenged, setScoreChallenged] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [done, setDone]     = useState('');

  // Ordered by list position so Carl finds people where he expects them.
  // Inactive players are left out: they keep their spot but the challenge
  // rules step over them, so moving one up here would shift every active
  // player's effective rank through a match the app would never have allowed.
  const options = useMemo(
    () => rankings
      .filter((r) => r.player.is_active)
      .map((r) => ({
        id: r.player.id,
        label: `#${r.ranking.position}  ${r.player.full_name}`,
      })),
    [rankings],
  );
  const inactiveCount = rankings.length - options.length;

  const nameOf = (id: string) =>
    rankings.find((r) => r.player.id === id)?.player.full_name ?? '';

  const race = Number(raceLength);
  const s1 = Number(scoreChallenger);
  const s2 = Number(scoreChallenged);
  const scoresEntered = scoreChallenger !== '' && scoreChallenged !== '';
  const winnerId =
    !scoresEntered || s1 === s2 ? '' : s1 > s2 ? challengerId : challengedId;

  const problem =
    !challengerId || !challengedId ? 'Pick both players.'
    : challengerId === challengedId ? 'Pick two different players.'
    : !Number.isInteger(race) || race < 1 ? 'Race length must be a whole number.'
    : race < LEAGUE.minRace ? `A race is at least ${LEAGUE.minRace} in this league.`
    : !scoresEntered ? 'Enter both scores.'
    : s1 === s2 ? 'A match cannot end level.'
    : Math.max(s1, s2) !== race ? `The winning score must be ${race} — the race length.`
    : '';

  const showProblem = problem && (challengerId !== '' || challengedId !== '' || scoresEntered);

  const submit = async () => {
    setSaving(true); setError(''); setDone('');
    try {
      const result = await callEdgeFunction('submit-result', {
        admin_entry: true,
        challenger_id: challengerId,
        challenged_id: challengedId,
        discipline,
        race_length: race,
        venue,
        winner_id: winnerId,
        final_score_player1: s1,
        final_score_player2: s2,
      });
      const joined = (result as { reused_existing_challenge?: boolean } | null)?.reused_existing_challenge;
      setDone(
        `Recorded: ${nameOf(winnerId)} won ${Math.max(s1, s2)}-${Math.min(s1, s2)}.`
        + (joined ? ' This finished the challenge these two already had open.' : ''),
      );
      setScoreChallenger(''); setScoreChallenged('');
      setChallengerId(''); setChallengedId('');
      qc.invalidateQueries({ queryKey: ['rankings'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['activity-feed'] });
    } catch (err) {
      setError(edgeErrorMessage(err, 'Could not record the match.'));
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <ClipboardPen size={18} className="text-[var(--toc-theme-accent-2)]" />
          <h2 className="font-[Bebas_Neue] text-xl tracking-wide text-[#E8E2D6]">
            Record a match
          </h2>
        </div>
        <p className="text-[#9CA3AF] text-xs font-[Barlow] mb-4">
          For players who do not use the app. This moves the list and updates
          both records exactly as if they had entered it themselves.
        </p>
        {inactiveCount > 0 && (
          <p className="text-[#6B7280] text-[10px] font-[Barlow] mb-4">
            {inactiveCount} inactive {inactiveCount === 1 ? 'player is' : 'players are'} left
            out — make them active first if one of them played.
          </p>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-[#9CA3AF] text-xs font-[Barlow] mb-1">Who challenged</label>
            <select
              value={challengerId}
              onChange={(e) => setChallengerId(e.target.value)}
              className={`${adminInputClass} w-full`}
            >
              <option value="">Choose a player...</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <p className="text-[#4B5563] text-[10px] font-[Barlow] mt-1">
              The player who called the other one out — normally the one lower down the list.
            </p>
          </div>

          <div>
            <label className="block text-[#9CA3AF] text-xs font-[Barlow] mb-1">Who was challenged</label>
            <select
              value={challengedId}
              onChange={(e) => setChallengedId(e.target.value)}
              className={`${adminInputClass} w-full`}
            >
              <option value="">Choose a player...</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <p className="text-[#4B5563] text-[10px] font-[Barlow] mt-1">
              The player defending their spot.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[#9CA3AF] text-xs font-[Barlow] mb-1">Game</label>
              <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} className={`${adminInputClass} w-full`}>
                {LEAGUE.disciplines.map((d) => <option key={d.value} value={d.value}>{d.value}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[#9CA3AF] text-xs font-[Barlow] mb-1">Race to</label>
              <input
                inputMode="numeric"
                value={raceLength}
                onChange={(e) => setRaceLength(e.target.value.replace(/\D/g, ''))}
                className={`${adminInputClass} w-full`}
              />
            </div>
            <div>
              <label className="block text-[#9CA3AF] text-xs font-[Barlow] mb-1">Where</label>
              <select value={venue} onChange={(e) => setVenue(e.target.value)} className={`${adminInputClass} w-full`}>
                {LEAGUE.sponsorBars.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[#9CA3AF] text-xs font-[Barlow] mb-1 truncate">
                {challengerId ? nameOf(challengerId) : 'Challenger'} score
              </label>
              <input
                inputMode="numeric"
                value={scoreChallenger}
                onChange={(e) => setScoreChallenger(e.target.value.replace(/\D/g, ''))}
                className={`${adminInputClass} w-full`}
              />
            </div>
            <div>
              <label className="block text-[#9CA3AF] text-xs font-[Barlow] mb-1 truncate">
                {challengedId ? nameOf(challengedId) : 'Challenged'} score
              </label>
              <input
                inputMode="numeric"
                value={scoreChallenged}
                onChange={(e) => setScoreChallenged(e.target.value.replace(/\D/g, ''))}
                className={`${adminInputClass} w-full`}
              />
            </div>
          </div>

          {winnerId && (
            <p className="text-[#22C55E] text-xs font-[Barlow]">Winner: {nameOf(winnerId)}</p>
          )}
          {showProblem && <p className="text-[#F59E0B] text-xs font-[Barlow]">{problem}</p>}
          {error && <p className="text-[#EF4444] text-xs font-[Barlow]">{error}</p>}
          {done && <p className="text-[#22C55E] text-xs font-[Barlow]">{done}</p>}

          <Button variant="primary" fullWidth disabled={problem !== '' || saving} loading={saving} onClick={submit}>
            Record it
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
