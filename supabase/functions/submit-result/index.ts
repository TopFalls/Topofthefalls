/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';
import { applyPostMatchCooldowns } from '../_shared/postMatchCooldowns.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// deno-lint-ignore-file no-explicit-any
async function sendPush(supabase: any, playerId: string, title: string, body: string, url: string): Promise<void> {
  try {
    const { data: row } = await supabase.from('push_subscriptions').select('subscription').eq('player_id', playerId).single();
    if (!row?.subscription) return;
    webpush.setVapidDetails(`mailto:${Deno.env.get('VAPID_SUBJECT')}`, Deno.env.get('VAPID_PUBLIC_KEY') ?? '', Deno.env.get('VAPID_PRIVATE_KEY') ?? '');
    await webpush.sendNotification(row.subscription, JSON.stringify({ title, body, url }));
  } catch {
    // Push delivery should never break match submission.
  }
}

type PaymentMethod = 'cash_envelope' | 'paypal' | 'cash_app' | 'venmo';

const PAYMENT_METHODS: PaymentMethod[] = ['cash_envelope', 'paypal', 'cash_app', 'venmo'];
const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash_envelope: 'Cash envelope',
  paypal: 'PayPal',
  cash_app: 'Cash App',
  venmo: 'Venmo',
};

const MATCH_FEE_CENTS = 500;

type SubmittedResult = {
  winnerId: string | null;
  player1Score: number | null;
  player2Score: number | null;
};

type CompleteSubmittedResult = {
  winnerId: string;
  player1Score: number;
  player2Score: number;
};

type MatchFeePayer = {
  player_id: string;
  player_name: string;
  payment_method: PaymentMethod;
};

function normalizePayment(value: unknown): PaymentMethod | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  return PAYMENT_METHODS.includes(value as PaymentMethod) ? (value as PaymentMethod) : null;
}

function getPlayerSubmission(match: Record<string, unknown>, playerNumber: 1 | 2): SubmittedResult {
  return {
    winnerId: match[`player${playerNumber}_submitted_winner_id`] as string | null,
    player1Score: match[`player${playerNumber}_submitted_player1_score`] as number | null,
    player2Score: match[`player${playerNumber}_submitted_player2_score`] as number | null,
  };
}

function isCompleteSubmission(submission: SubmittedResult): submission is CompleteSubmittedResult {
  return Boolean(submission.winnerId)
    && Number.isInteger(submission.player1Score)
    && Number.isInteger(submission.player2Score);
}

function submissionsMatch(player1Submission: SubmittedResult, player2Submission: SubmittedResult): boolean {
  return player1Submission.winnerId === player2Submission.winnerId
    && player1Submission.player1Score === player2Submission.player1Score
    && player1Submission.player2Score === player2Submission.player2Score;
}

function validateFinalScore(
  winnerId: string,
  player1Id: string,
  player2Id: string,
  finalScorePlayer1: number,
  finalScorePlayer2: number,
  raceTarget: number,
): string | null {
  if (!Number.isInteger(finalScorePlayer1) || !Number.isInteger(finalScorePlayer2) || finalScorePlayer1 < 0 || finalScorePlayer2 < 0) {
    return 'Scores must be non-negative whole numbers.';
  }
  if (finalScorePlayer1 > raceTarget || finalScorePlayer2 > raceTarget) {
    return 'Score cannot exceed race length.';
  }
  if (finalScorePlayer1 === finalScorePlayer2) {
    return 'Tie not possible. Select the player who reached the race length.';
  }
  if (![player1Id, player2Id].includes(winnerId)) {
    return 'Winner must be one of the match players.';
  }

  const winnerScore = winnerId === player1Id ? finalScorePlayer1 : finalScorePlayer2;
  const loserScore = winnerId === player1Id ? finalScorePlayer2 : finalScorePlayer1;
  if (winnerScore < raceTarget) return `Winner must reach race length ${raceTarget}.`;
  if (loserScore >= raceTarget) return 'Only the winner can reach the race length.';
  return null;
}

async function recordMatchFeePayments(
  supabase: SupabaseClient,
  matchId: string,
  actorProfileId: string,
  payers: MatchFeePayer[],
): Promise<void> {
  if (payers.length === 0) return;

  const shortMatch = matchId.slice(0, 8);
  const rows = payers.map((payer) => ({
    entry_type: 'credit',
    amount_cents: 500,
    description: `Match fee · ${payer.player_name} · ${PAYMENT_METHOD_LABELS[payer.payment_method]} · match ${shortMatch}`,
    created_by: actorProfileId,
    source_type: 'match_fee',
    source_id: matchId,
    player_id: payer.player_id,
    metadata: {
      match_id: matchId,
      player_id: payer.player_id,
      player_name: payer.player_name,
      payment_method: payer.payment_method,
      amount_cents: MATCH_FEE_CENTS,
    },
  }));

  for (const row of rows) {
    const { error } = await supabase.from('treasury_ledger').insert(row);
    if (!error) continue;
    // 23505 = unique_violation (idempotent retry); anything else is a real failure.
    if ((error as { code?: string }).code !== '23505') {
      throw error;
    }
  }
}

// Records the $5 match fee for each player who attached a payment method to
// the match, regardless of whether the match is heading to confirmed or
// disputed. Called from both paths so admin dispute resolution doesn't have
// to chase down payment methods after the fact.
async function recordSubmittedMatchFees(
  supabase: SupabaseClient,
  match: Record<string, unknown>,
  actorProfileId: string,
): Promise<void> {
  const matchId = match.id as string;
  const player1Id = match.player1_id as string;
  const player2Id = match.player2_id as string;
  const player1PaymentMethod = normalizePayment(match.player1_payment_method);
  const player2PaymentMethod = normalizePayment(match.player2_payment_method);

  if (!player1PaymentMethod && !player2PaymentMethod) return;

  const [{ data: p1Player }, { data: p2Player }] = await Promise.all([
    supabase.from('players').select('full_name').eq('id', player1Id).single(),
    supabase.from('players').select('full_name').eq('id', player2Id).single(),
  ]);

  const payers: MatchFeePayer[] = [];
  if (player1PaymentMethod) {
    payers.push({
      player_id: player1Id,
      player_name: p1Player?.full_name ?? 'Player 1',
      payment_method: player1PaymentMethod,
    });
  }
  if (player2PaymentMethod) {
    payers.push({
      player_id: player2Id,
      player_name: p2Player?.full_name ?? 'Player 2',
      payment_method: player2PaymentMethod,
    });
  }

  if (payers.length === 0) return;

  await recordMatchFeePayments(supabase, matchId, actorProfileId, payers);
  for (const payer of payers) {
    const { data: existing } = await supabase
      .from('activity_feed')
      .select('id')
      .eq('event_type', 'match_fee_recorded')
      .eq('actor_player_id', payer.player_id)
      .ilike('detail', `%${matchId.slice(0, 8)}%`)
      .limit(1)
      .maybeSingle();
    if (existing) continue;
    await supabase.from('activity_feed').insert({
      event_type: 'match_fee_recorded',
      headline: `${payer.player_name} paid the $5 match fee · ${PAYMENT_METHOD_LABELS[payer.payment_method]}`,
      detail: `Match ${matchId.slice(0, 8)} · credited to league treasury`,
      actor_player_id: payer.player_id,
    });
  }
}

// The rank-1 obligation used to live here: a 30-day, two-top-5-matches rule
// inherited from TOC. Carl's Top of the Falls rules place no obligation on the
// #1 player, and 20260615120000 disabled the database side of it — but this
// copy survived and would have announced a demotion that never happened, since
// apply_rank1_penalty is a no-op. Removed entirely; nothing writes rank1_since.

async function confirmResult(
  supabase: SupabaseClient,
  matchId: string,
  winnerId: string,
  loserId: string,
  p1Score: number,
  p2Score: number,
  match: { discipline: string; race_length: number; player1_id: string; player2_id: string; challenge_id: string },
) {
  const completedAt = new Date().toISOString();
  const { error: matchError } = await supabase.from('matches').update({ status: 'confirmed', winner_id: winnerId, loser_id: loserId, player1_score: p1Score, player2_score: p2Score, completed_at: completedAt }).eq('id', matchId);
  if (matchError) throw matchError;

  const { error: challengeError } = await supabase.from('challenges').update({ status: 'confirmed' }).eq('id', match.challenge_id);
  if (challengeError) throw challengeError;

  const [winnerRank, loserRank] = await Promise.all([
    supabase.from('rankings').select('position').eq('player_id', winnerId).single(),
    supabase.from('rankings').select('position').eq('player_id', loserId).single(),
  ]);
  const winnerIsChallenger = match.player1_id === winnerId;

  // Rule 5b applies only when the challenger won from below and moved up.
  let winnerMovedUp = false;

  if (winnerRank.data && loserRank.data) {
    const wPos = winnerRank.data.position;
    const lPos = loserRank.data.position;
    let winnerCurrentPosition = wPos;
    if (wPos > lPos) {
      winnerMovedUp = true;
      const { error: cascadeError } = await supabase.rpc('cascade_ranking_after_win', { p_winner_id: winnerId, p_loser_id: loserId });
      if (cascadeError) throw cascadeError;

      const { data: refreshedWinnerRank, error: refreshedWinnerRankError } = await supabase
        .from('rankings')
        .select('position')
        .eq('player_id', winnerId)
        .single();
      if (refreshedWinnerRankError) throw refreshedWinnerRankError;
      winnerCurrentPosition = refreshedWinnerRank?.position ?? winnerCurrentPosition;
    }

    const [winnerStats, loserStats] = await Promise.all([
      supabase.from('player_season_stats').select('*').eq('player_id', winnerId).single(),
      supabase.from('player_season_stats').select('*').eq('player_id', loserId).single(),
    ]);
    if (winnerStats.data) {
      const s = winnerStats.data;
      const newStreak = s.current_streak >= 0 ? s.current_streak + 1 : 1;
      const bestRank = s.best_rank_achieved === null || winnerCurrentPosition < s.best_rank_achieved ? winnerCurrentPosition : s.best_rank_achieved;
      const { error: winnerStatsError } = await supabase.from('player_season_stats').update({ wins: s.wins + 1, matches_played: s.matches_played + 1, current_streak: newStreak, best_streak: Math.max(s.best_streak, newStreak), challenger_wins: winnerIsChallenger ? s.challenger_wins + 1 : s.challenger_wins, defender_wins: !winnerIsChallenger ? s.defender_wins + 1 : s.defender_wins, best_rank_achieved: bestRank }).eq('player_id', winnerId);
      if (winnerStatsError) throw winnerStatsError;
    }

    if (loserStats.data) {
      const s = loserStats.data;
      const { error: loserStatsError } = await supabase.from('player_season_stats').update({ losses: s.losses + 1, matches_played: s.matches_played + 1, current_streak: 0 }).eq('player_id', loserId);
      if (loserStatsError) throw loserStatsError;
    }
  }

  await applyPostMatchCooldowns(supabase, loserId, winnerId, winnerMovedUp, match.player2_id, completedAt);

  const disc = match.discipline;
  const disciplineSeeds = await Promise.all([winnerId, loserId].map((pid) => supabase.from('player_discipline_stats').upsert({ player_id: pid, discipline: disc }, { onConflict: 'player_id,discipline', ignoreDuplicates: true })));
  for (const seed of disciplineSeeds) {
    if (seed.error) throw seed.error;
  }

  for (const [pid, isWinner, isChallenger] of [[winnerId, true, winnerIsChallenger], [loserId, false, !winnerIsChallenger]] as [string, boolean, boolean][]) {
    const { data: ds } = await supabase.from('player_discipline_stats').select('*').eq('player_id', pid).eq('discipline', disc).single();
    if (ds) {
      const newStreak = isWinner ? (ds.current_streak >= 0 ? ds.current_streak + 1 : 1) : 0;
      const { error: disciplineStatsError } = await supabase.from('player_discipline_stats').update({ matches_played: ds.matches_played + 1, wins: isWinner ? ds.wins + 1 : ds.wins, losses: isWinner ? ds.losses : ds.losses + 1, current_streak: newStreak, best_streak: isWinner ? Math.max(ds.best_streak, newStreak) : ds.best_streak, challenger_wins: isWinner && isChallenger ? ds.challenger_wins + 1 : ds.challenger_wins, defender_wins: isWinner && !isChallenger ? ds.defender_wins + 1 : ds.defender_wins, total_race_length: ds.total_race_length + match.race_length, updated_at: new Date().toISOString() }).eq('player_id', pid).eq('discipline', disc);
      if (disciplineStatsError) throw disciplineStatsError;
    }
  }

  const [wp, lp] = await Promise.all([
    supabase.from('players').select('full_name').eq('id', winnerId).single(),
    supabase.from('players').select('full_name').eq('id', loserId).single(),
  ]);

  const { error: notificationError } = await supabase.from('notifications').insert([
    { player_id: winnerId, type: 'result_confirmed', title: '🏆 Match confirmed — Victory!', body: `Final: ${p1Score}–${p2Score}`, reference_id: matchId, reference_type: 'match' },
    { player_id: loserId, type: 'result_confirmed', title: '📊 Match confirmed', body: `Final: ${p1Score}–${p2Score}`, reference_id: matchId, reference_type: 'match' },
  ]);
  if (notificationError) throw notificationError;
  await Promise.all([
    sendPush(supabase, winnerId, '🏆 Match confirmed — Victory!', `Final: ${p1Score}–${p2Score}`, `/match/${matchId}`),
    sendPush(supabase, loserId, '📊 Match confirmed', `Final: ${p1Score}–${p2Score}`, `/match/${matchId}`),
  ]);
  const { error: activityError } = await supabase.from('activity_feed').insert({ event_type: 'match_confirmed', headline: `${wp.data?.full_name} def. ${lp.data?.full_name} · ${p1Score}–${p2Score}`, actor_player_id: winnerId });
  if (activityError) throw activityError;
}


// -- Admin-entered results (questionnaire K3) --------------------------------
//
// Carl: "Leave them on the list I will enter there results myself." Some of the
// 119 players have no email or will not use an app, but they still play and
// still move on the list. This lets an admin record a finished match for them.
//
// It reuses confirmResult, the same path a normal two-player confirmation
// takes, so the ladder swap, stats, streaks, cooldowns, feed and notifications
// all behave identically. A second copy of those rules is exactly how the two
// halves of this app drift apart.
//
// The important subtlety is that the match may ALREADY exist in the app. If A
// challenged B in the app and they then played it on a night B could not be
// bothered to open his phone, there is a live challenge sitting there. Writing
// a fresh one and leaving the original open would let the hourly expiry cron
// forfeit it an hour later and move the ladder a second time, quietly
// overturning the result Carl just typed in. So: find the live challenge
// first, and finish THAT one.
//
// Match fees are NOT recorded here. A player who does not use the app pays Carl
// in person, and inventing a payment method would put a false line in the
// treasury.
async function handleAdminEntry(
  supabase: SupabaseClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const bad = (message: string, status = 400) => json({ error: message }, status);

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single();
  if (!profile || !['admin', 'super_admin'].includes(profile.role as string)) {
    return bad('Only a league admin can enter a result for other players.', 403);
  }

  let challengerId = body.challenger_id as string;
  let challengedId = body.challenged_id as string;
  let discipline = body.discipline as string;
  let raceLength = Number(body.race_length);
  let venue = body.venue as string;
  const winnerId = body.winner_id as string;
  const p1Score = Number(body.final_score_player1);
  const p2Score = Number(body.final_score_player2);

  if (!challengerId || !challengedId) return bad('Pick both players.');
  if (challengerId === challengedId) return bad('A player cannot play themselves.');
  if (!discipline) return bad('Pick a game.');
  if (!venue) return bad('Pick where it was played.');
  if (!Number.isInteger(raceLength) || raceLength < 1) return bad('Race length must be a whole number.');
  if (winnerId !== challengerId && winnerId !== challengedId) return bad('The winner must be one of the two players.');

  // The database CHECK lists reject anything off-menu, and that error would
  // surface to Carl as an opaque 500. Check against the league's own settings
  // first, the way create-challenge does.
  const { data: settings } = await supabase
    .from('league_settings')
    .select('min_race, max_race, disciplines, venues')
    .limit(1)
    .maybeSingle();
  const disciplines: string[] = settings?.disciplines ?? ['8 Ball', '9 Ball', '10 Ball', 'Saratoga'];
  const venues: string[] = settings?.venues ?? ['Silver Spur', 'Lido', 'Black Eagle Country Club'];
  const minRace: number = settings?.min_race ?? 6;
  const maxRace: number | null = settings?.max_race ?? null;
  if (!disciplines.includes(discipline)) return bad(`${discipline} is not one of the league's games.`);
  if (!venues.includes(venue)) return bad(`${venue} is not one of the league's venues.`);
  if (raceLength < minRace) return bad(`A race is at least ${minRace} in this league.`);
  if (maxRace != null && raceLength > maxRace) return bad(`A race is at most ${maxRace} in this league.`);

  // Inactive players are stepped over by the challenge rules and cannot be
  // challenged at all, so an admin-entered result must not move one up the
  // list either — that would shift every active player's effective rank.
  const { data: bothPlayers } = await supabase
    .from('players').select('id, full_name, is_active').in('id', [challengerId, challengedId]);
  if (!bothPlayers || bothPlayers.length !== 2) return bad('Both players must be on the list.', 404);
  const inactive = bothPlayers.filter((pl: { is_active: boolean }) => !pl.is_active);
  if (inactive.length) {
    return bad(`${inactive.map((pl: { full_name: string }) => pl.full_name).join(' and ')} is marked inactive. Make them active before recording a match.`, 409);
  }

  const { data: ladder } = await supabase.from('rankings').select('player_id').in('player_id', [challengerId, challengedId]);
  if (!ladder || ladder.length !== 2) return bad('Both players must be on the list.', 404);

  // Recording the same game twice would double every counter. confirmResult is
  // a dozen sequential writes with no transaction around them, so a transient
  // failure late on returns a generic 500 and invites exactly that retry.
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('matches')
    .select('id, player1_id, player2_id, player1_score, player2_score')
    .eq('status', 'confirmed')
    .gte('completed_at', tenMinutesAgo)
    .in('player1_id', [challengerId, challengedId])
    .in('player2_id', [challengerId, challengedId]);
  const duplicate = (recent ?? []).find((m: Record<string, number | string>) =>
    Math.max(Number(m.player1_score), Number(m.player2_score)) === Math.max(p1Score, p2Score) &&
    Math.min(Number(m.player1_score), Number(m.player2_score)) === Math.min(p1Score, p2Score));
  if (duplicate) {
    return bad('That looks like the same match again — it was recorded in the last few minutes. Check the Matches tab before entering it a second time.', 409);
  }

  // Is this game already on the board? If so, finish the row that exists
  // rather than writing a rival one and leaving the original to be forfeited
  // by the expiry job.
  const { data: liveChallenges } = await supabase
    .from('challenges')
    .select('id, challenger_id, challenged_id, discipline, race_length, venue')
    .in('status', ['pending', 'accepted', 'scheduled', 'in_progress'])
    .in('challenger_id', [challengerId, challengedId])
    .in('challenged_id', [challengerId, challengedId]);
  const existing = (liveChallenges ?? [])[0] as
    { id: string; challenger_id: string; challenged_id: string; discipline: string; race_length: number; venue: string | null } | undefined;

  let challengeId: string;
  let reusedChallenge = false;

  if (existing) {
    // The live challenge is the authoritative record of who called whom, and
    // the ladder maths keys off it. Take its orientation over the form's.
    challengerId = existing.challenger_id;
    challengedId = existing.challenged_id;
    discipline = existing.discipline;
    raceLength = existing.race_length;
    venue = existing.venue ?? venue;
    challengeId = existing.id;
    reusedChallenge = true;
  } else {
    const nowIso = new Date().toISOString();
    const { data: challenge, error: challengeError } = await supabase.from('challenges').insert({
      challenger_id: challengerId,
      challenged_id: challengedId,
      discipline,
      race_length: raceLength,
      venue,
      status: 'accepted',
      scheduled_at: nowIso,
      expires_at: nowIso,
    }).select().single();
    if (challengeError) throw challengeError;
    challengeId = challenge.id;

    // create-challenge keeps these counters for every challenge it writes, and
    // the admin stats page reads them. Without this the players Carl enters by
    // hand never appear on the challenge leaderboards at all.
    for (const [pid, column] of [[challengerId, 'challenges_issued'], [challengedId, 'challenges_received']] as [string, string][]) {
      const { data: seasonRow } = await supabase.from('player_season_stats').select(column).eq('player_id', pid).maybeSingle<Record<string, number>>();
      if (seasonRow) {
        await supabase.from('player_season_stats').update({ [column]: seasonRow[column] + 1 }).eq('player_id', pid);
      }
    }
  }

  // Scores are validated against the orientation we settled on above, not the
  // one the form guessed, because player1 is always the challenger.
  const scoreError = validateFinalScore(winnerId, challengerId, challengedId, p1Score, p2Score, raceLength);
  if (scoreError) return bad(scoreError);

  const nowIso = new Date().toISOString();
  const { data: priorMatch } = await supabase
    .from('matches').select('id, status').eq('challenge_id', challengeId).maybeSingle();

  if (priorMatch && ['confirmed', 'resolved'].includes(priorMatch.status as string)) {
    return bad('That match has already been recorded.', 409);
  }

  // Every submitted-detail column is filled in, not just the two flags. If this
  // request dies before confirmResult finishes, a half-written row that one of
  // the players later submits against would otherwise fail isCompleteSubmission
  // and land in Carl's dispute queue for a game nobody disputed.
  const matchFields = {
    player1_id: challengerId,
    player2_id: challengedId,
    discipline,
    race_length: raceLength,
    venue,
    scheduled_at: nowIso,
    started_at: nowIso,
    status: 'in_progress',
    player1_score: p1Score,
    player2_score: p2Score,
    player1_submitted: true,
    player2_submitted: true,
    player1_submitted_winner_id: winnerId,
    player2_submitted_winner_id: winnerId,
    player1_submitted_player1_score: p1Score,
    player1_submitted_player2_score: p2Score,
    player2_submitted_player1_score: p1Score,
    player2_submitted_player2_score: p2Score,
    player1_submitted_at: nowIso,
    player2_submitted_at: nowIso,
  };

  let match: Record<string, unknown>;
  if (priorMatch) {
    const { data: updated, error: updateError } = await supabase
      .from('matches').update(matchFields).eq('id', priorMatch.id).select().single();
    if (updateError) throw updateError;
    match = updated;
  } else {
    const { data: inserted, error: matchError } = await supabase
      .from('matches').insert({ challenge_id: challengeId, ...matchFields }).select().single();
    if (matchError) throw matchError;
    match = inserted;
  }

  const loserId = winnerId === challengerId ? challengedId : challengerId;
  await confirmResult(supabase, match.id as string, winnerId, loserId, p1Score, p2Score, match as never);

  const { error: auditError } = await supabase.from('audit_events').insert({
    actor_profile_id: userId,
    action: 'match.admin_recorded',
    target_type: 'match',
    target_id: match.id as string,
    detail: {
      challenger_id: challengerId, challenged_id: challengedId, winner_id: winnerId,
      player1_score: p1Score, player2_score: p2Score, discipline, race_length: raceLength, venue,
      reused_existing_challenge: reusedChallenge,
    },
  });
  if (auditError) throw auditError;

  return json({ success: true, match_id: match.id, reused_existing_challenge: reusedChallenge });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: { user } } = await supabase.auth.getUser(req.headers.get('Authorization')?.replace('Bearer ', ''));
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });

    const body = await req.json();
    // An admin recording a result for players who do not use the app.
    if (body?.admin_entry === true) return await handleAdminEntry(supabase, user.id, body);

    const { match_id, winner_id, final_score_player1, final_score_player2, payment_method } = body;
    const normalizedPayment = normalizePayment(payment_method);
    if (payment_method != null && payment_method !== '' && normalizedPayment === null) return new Response(JSON.stringify({ error: 'Invalid payment method.' }), { status: 400, headers: cors });

    const { data: match } = await supabase.from('matches').select('*').eq('id', match_id).single();
    if (!match) return new Response(JSON.stringify({ error: 'Match not found.' }), { status: 404, headers: cors });
    if (!['in_progress', 'scheduled', 'submitted'].includes(match.status)) return new Response(JSON.stringify({ error: 'Match is not in progress.' }), { status: 409, headers: cors });

    const raceTarget = match.race_length;
    const scoreError = validateFinalScore(winner_id, match.player1_id, match.player2_id, final_score_player1, final_score_player2, raceTarget);
    if (scoreError) return new Response(JSON.stringify({ error: scoreError }), { status: 400, headers: cors });

    const { data: caller } = await supabase.from('players').select('id').eq('profile_id', user.id).single();
    if (!caller) return new Response(JSON.stringify({ error: 'Player not found.' }), { status: 404, headers: cors });
    const isP1 = match.player1_id === caller.id;
    const isP2 = match.player2_id === caller.id;
    if (!isP1 && !isP2) return new Response(JSON.stringify({ error: 'Not a participant.' }), { status: 403, headers: cors });

    const submissionUpdates: Record<string, unknown> = { status: 'submitted' };
    const submittedAt = new Date().toISOString();
    if (isP1) {
      submissionUpdates.player1_submitted = true;
      submissionUpdates.player1_submitted_winner_id = winner_id;
      submissionUpdates.player1_submitted_player1_score = final_score_player1;
      submissionUpdates.player1_submitted_player2_score = final_score_player2;
      submissionUpdates.player1_submitted_at = submittedAt;
      if (normalizedPayment) submissionUpdates.player1_payment_method = normalizedPayment;
    } else {
      submissionUpdates.player2_submitted = true;
      submissionUpdates.player2_submitted_winner_id = winner_id;
      submissionUpdates.player2_submitted_player1_score = final_score_player1;
      submissionUpdates.player2_submitted_player2_score = final_score_player2;
      submissionUpdates.player2_submitted_at = submittedAt;
      if (normalizedPayment) submissionUpdates.player2_payment_method = normalizedPayment;
    }

    const { error: submissionError } = await supabase
      .from('matches')
      .update(submissionUpdates)
      .eq('id', match_id)
      .in('status', ['scheduled', 'in_progress', 'submitted']);
    if (submissionError) throw submissionError;

    const { data: updated } = await supabase.from('matches').select('*').eq('id', match_id).single();
    if (!updated) return new Response(JSON.stringify({ error: 'Update failed.' }), { status: 500, headers: cors });

    if (updated.player1_submitted && updated.player2_submitted) {
      const { data: claimed } = await supabase.from('matches').update({ status: 'confirming' } as Record<string, unknown>).eq('id', match_id).eq('status', 'submitted').select('id');
      if (!claimed?.length) return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });

      const player1Submission = getPlayerSubmission(updated, 1);
      const player2Submission = getPlayerSubmission(updated, 2);

      if (!isCompleteSubmission(player1Submission) || !isCompleteSubmission(player2Submission)) {
        await supabase.from('matches').update({ status: 'disputed' }).eq('id', match_id).eq('status', 'confirming');
        await recordSubmittedMatchFees(supabase, updated, user.id);
        return new Response(JSON.stringify({ success: true, disputed: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      if (!submissionsMatch(player1Submission, player2Submission)) {
        const { error: disputeError } = await supabase.from('matches').update({ status: 'disputed' }).eq('id', match_id).eq('status', 'confirming');
        if (disputeError) throw disputeError;

        const [{ data: p1Player }, { data: p2Player }] = await Promise.all([
          supabase.from('players').select('full_name').eq('id', updated.player1_id).single(),
          supabase.from('players').select('full_name').eq('id', updated.player2_id).single(),
        ]);
        await supabase.from('notifications').insert([
          { player_id: updated.player1_id, type: 'result_disputed', title: 'Match result needs review', body: `Your submitted result did not match ${p2Player?.full_name ?? 'your opponent'}'s submission. An admin will review it.`, reference_id: match_id, reference_type: 'match' },
          { player_id: updated.player2_id, type: 'result_disputed', title: 'Match result needs review', body: `Your submitted result did not match ${p1Player?.full_name ?? 'your opponent'}'s submission. An admin will review it.`, reference_id: match_id, reference_type: 'match' },
        ]);
        await supabase.from('activity_feed').insert({
          event_type: 'match_disputed',
          headline: `${p1Player?.full_name ?? 'Player 1'} and ${p2Player?.full_name ?? 'Player 2'} submitted different match results.`,
          detail: `${updated.discipline} match ${match_id.slice(0, 8)} needs admin review.`,
        });

        await recordSubmittedMatchFees(supabase, updated, user.id);
        return new Response(JSON.stringify({ success: true, disputed: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      const finalWinnerId = player1Submission.winnerId;
      const finalPlayer1Score = player1Submission.player1Score;
      const finalPlayer2Score = player1Submission.player2Score;
      const finalScoreError = validateFinalScore(finalWinnerId, updated.player1_id, updated.player2_id, finalPlayer1Score, finalPlayer2Score, updated.race_length);
      if (finalScoreError) {
        const { error: disputeError } = await supabase.from('matches').update({ status: 'disputed' }).eq('id', match_id).eq('status', 'confirming');
        if (disputeError) throw disputeError;
        await recordSubmittedMatchFees(supabase, updated, user.id);
        return new Response(JSON.stringify({ success: true, disputed: true, error: finalScoreError }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      const loser_id = finalWinnerId === updated.player1_id ? updated.player2_id : updated.player1_id;
      await confirmResult(supabase, match_id, finalWinnerId, loser_id, finalPlayer1Score, finalPlayer2Score, updated);

      const { data: finalMatch } = await supabase.from('matches').select('*').eq('id', match_id).single();
      if (finalMatch) {
        await recordSubmittedMatchFees(supabase, finalMatch, user.id);
      }
    } else {
      const otherId = isP1 ? match.player2_id : match.player1_id;
      const { data: callerPlayer } = await supabase.from('players').select('full_name').eq('id', caller.id).single();
      await supabase.from('notifications').insert({ player_id: otherId, type: 'result_submitted', title: '📊 Opponent submitted result', body: `${callerPlayer?.full_name} submitted the match result. Please submit yours to confirm.`, reference_id: match_id, reference_type: 'match' });
      await sendPush(supabase, otherId, '📊 Opponent submitted result', `${callerPlayer?.full_name} submitted. Tap to confirm.`, `/match/${match_id}`);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    const detail = e instanceof Error
      ? { message: e.message, name: e.name, stack: e.stack }
      : e && typeof e === 'object'
        ? e
        : { message: String(e) };
    console.error('submit-result failed', detail);
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});

