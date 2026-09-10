/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// deno-lint-ignore-file no-explicit-any
async function sendPush(supabase: any, playerId: string, title: string, body: string, url: string): Promise<void> {
  try {
    const { data: row } = await supabase.from('push_subscriptions').select('subscription').eq('player_id', playerId).single();
    if (!row?.subscription) return;
    webpush.setVapidDetails(`mailto:${Deno.env.get('VAPID_SUBJECT')}`, Deno.env.get('VAPID_PUBLIC_KEY') ?? '', Deno.env.get('VAPID_PRIVATE_KEY') ?? '');
    await webpush.sendNotification(row.subscription, JSON.stringify({ title, body, url }));
  } catch {
    // Push delivery should never break challenge creation.
  }
}

// Positions here are *active ranks* — a player's place among active players,
// with inactive players skipped. See the caller.
function canChallenge(
  myPos: number,
  theirPos: number,
  challengeRange: number,
): string | null {
  if (myPos === theirPos) return 'You cannot challenge yourself.';

  // Challenges go upward only. Carl's rules place no obligation on #1, so the
  // player at the top has nobody to challenge and only defends. (A previous
  // version let #1 challenge #2-#5 "to satisfy the rank-1 obligation" — that is
  // a TOC rule the Top of the Falls ruleset does not have.)
  if (theirPos >= myPos) return 'You can only challenge players ranked above you.';

  // TOF rule: Top 10 can only move one spot at a time.
  if (myPos <= 10) {
    if (theirPos === myPos - 1) return null;
    return 'Players in the Top 10 can only challenge one spot above them.';
  }

  // TOF rule: spots 11+ may challenge up to the configured challenge range.
  if ((myPos - theirPos) > challengeRange) {
    return `You can only challenge players up to ${challengeRange} spots above you.`;
  }

  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const authHeader = req.headers.get('Authorization');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader?.replace('Bearer ', ''));
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    // `preview` runs every guard below and then stops before the first write,
    // so the challenge screen can tell a player what issuing this challenge
    // would cost them. See the preview return further down for why it is done
    // this way rather than in SQL.
    const { challenged_player_id, discipline, race_length, preview } = await req.json();
    const isPreview = preview === true;

    const { data: settings } = await supabase
      .from('league_settings')
      .select('min_race, max_race, challenge_range, challenge_expiry_days, challenge_weekly_limit, challenge_response_hours, disciplines')
      .single();

    const minRace = settings?.min_race ?? 6;
    const maxRace = settings?.max_race;
    const challengeRange = settings?.challenge_range ?? 2;
    const challengeExpiryDays = settings?.challenge_expiry_days ?? 2;
    const weeklyLimit = settings?.challenge_weekly_limit ?? 2;
    // Rule 3: the challenged player must respond within 48 hrs of the callout.
    const responseHours = settings?.challenge_response_hours ?? challengeExpiryDays * 24;

    const validDisciplines = Array.isArray(settings?.disciplines) && settings.disciplines.length > 0
      ? settings.disciplines
      : ['8 Ball', '9 Ball', '10 Ball', 'Saratoga'];
    if (!validDisciplines.includes(discipline)) return new Response(JSON.stringify({ error: 'Invalid discipline.' }), { status: 400, headers: corsHeaders });
    if (!Number.isInteger(race_length) || race_length < minRace) return new Response(JSON.stringify({ error: `Race length must be at least ${minRace}.` }), { status: 400, headers: corsHeaders });
    if (Number.isInteger(maxRace) && race_length > maxRace) return new Response(JSON.stringify({ error: `Race length cannot exceed ${maxRace}.` }), { status: 400, headers: corsHeaders });

    const { data: challenger } = await supabase.from('players').select('id, is_active').eq('profile_id', user.id).single();
    if (!challenger) return new Response(JSON.stringify({ error: 'You must claim a player profile first.' }), { status: 403, headers: corsHeaders });
    if (!challenger.is_active) return new Response(JSON.stringify({ error: 'Your account is inactive.' }), { status: 403, headers: corsHeaders });
    if (challenger.id === challenged_player_id) return new Response(JSON.stringify({ error: 'You cannot challenge yourself.' }), { status: 400, headers: corsHeaders });

    const { data: challenged } = await supabase.from('players').select('id, is_active').eq('id', challenged_player_id).single();
    if (!challenged) return new Response(JSON.stringify({ error: 'That player does not exist.' }), { status: 404, headers: corsHeaders });
    if (!challenged.is_active) return new Response(JSON.stringify({ error: 'That player is currently inactive and cannot be challenged.' }), { status: 409, headers: corsHeaders });

    // Inactive players keep their spot on the list but the challenge rules step
    // over them, so eligibility is judged on rank among active players. The
    // whole ladder is needed to derive that. Mirrors activeRankByPosition in
    // src/lib/ladder.ts — keep the two in step.
    const [ladderRes, activeRes] = await Promise.all([
      supabase.from('rankings').select('player_id, position').order('position'),
      supabase.from('players').select('id').eq('is_active', true),
    ]);
    if (ladderRes.error || !ladderRes.data || activeRes.error) {
      return new Response(JSON.stringify({ error: 'Could not retrieve rankings.' }), { status: 404, headers: corsHeaders });
    }

    const activeIds = new Set((activeRes.data ?? []).map((p: { id: string }) => p.id));
    // Every active player's rank, not just the two in this challenge - the
    // open-player rule below has to ask "was anyone else available?".
    const activeRankByPlayer = new Map<string, number>();
    let myPos = 0, theirPos = 0, myRank = 0, theirRank = 0, activeRank = 0;
    for (const row of ladderRes.data as { player_id: string; position: number }[]) {
      const isActive = activeIds.has(row.player_id);
      if (isActive) {
        activeRank += 1;
        activeRankByPlayer.set(row.player_id, activeRank);
      }
      if (row.player_id === challenger.id) {
        myPos = row.position;
        if (isActive) myRank = activeRank;
      }
      if (row.player_id === challenged_player_id) {
        theirPos = row.position;
        if (isActive) theirRank = activeRank;
      }
    }
    if (!myPos || !theirPos) return new Response(JSON.stringify({ error: 'Could not retrieve rankings.' }), { status: 404, headers: corsHeaders });
    if (!myRank || !theirRank) return new Response(JSON.stringify({ error: 'Inactive players cannot take part in challenges.' }), { status: 409, headers: corsHeaders });

    await supabase.rpc('expire_stale_challenges');

    const eligibilityError = canChallenge(myRank, theirRank, challengeRange);
    if (eligibilityError) return new Response(JSON.stringify({ error: eligibilityError }), { status: 400, headers: corsHeaders });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { count: weeklyCount } = await supabase.from('challenges').select('id', { count: 'exact', head: true }).eq('challenger_id', challenger.id).gte('created_at', sevenDaysAgo);
    if ((weeklyCount ?? 0) >= weeklyLimit) return new Response(JSON.stringify({ error: `You have reached the weekly challenge limit (${weeklyLimit} per 7 days).` }), { status: 429, headers: corsHeaders });

    // limit(1): a bare maybeSingle() errors when more than one row matches and
    // hands back data:null, which reads as "no outgoing challenge" and would
    // let a player who somehow holds two stack up more.
    const { data: existingOut, error: existingOutError } = await supabase.from('challenges').select('id').eq('challenger_id', challenger.id).in('status', ['pending', 'accepted', 'scheduled', 'in_progress']).limit(1).maybeSingle();
    if (existingOutError) return new Response(JSON.stringify({ error: 'Could not check your existing challenges. Please try again.' }), { status: 503, headers: corsHeaders });
    if (existingOut) return new Response(JSON.stringify({ error: 'You already have an active outgoing challenge.' }), { status: 409, headers: corsHeaders });

    // Every cooldown blocks issuing a challenge and none of them block
    // accepting one — that is what the rules mean by "defend or wait".
    //   post_match  rule 5b/5c, after a result
    //   reentry     back from inactive: defend, or wait
    //   wash        rule 4, the challenger sits after a wash
    const now = new Date().toISOString();
    const { data: myCooldown } = await supabase
      .from('cooldowns')
      .select('type, expires_at')
      .eq('player_id', challenger.id)
      .gt('expires_at', now)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (myCooldown) {
      const until = new Date(myCooldown.expires_at).toLocaleString();
      const message = myCooldown.type === 'reentry'
        ? `You have just come back from inactive. Defend your spot, or wait until ${until} to challenge up.`
        : myCooldown.type === 'wash'
          ? `Your last challenge was called a wash. You can challenge again after ${until}.`
          : `You are in a post-match cooldown period until ${until}.`;
      return new Response(JSON.stringify({ error: message }), { status: 429, headers: corsHeaders });
    }

    // -- Who may be challenged (questionnaire B5, L4, L5) --------------------
    //
    // Carl's answers, joined up: a player can be challenged by more than one
    // person at once ("Many"), and you may always challenge somebody already
    // tied up in a match - but if an OPEN player was sitting there in your
    // range and you skipped them to chase a match result instead, you give up
    // your own protection and anyone below you may challenge you while you
    // wait.
    //
    // This changes live play and it is read off three free-text answers rather
    // than a rule Carl stated outright, so it sits behind a switch:
    // league_settings.open_player_rule, which ships ON because that is what he
    // asked for. Turn it off and the original rule comes straight back - one
    // incoming challenge at a time, everybody in a challenge protected - with
    // no deploy:
    //
    //   UPDATE league_settings SET open_player_rule = false;
    //
    // If the column is missing entirely the select fails and the rule stays
    // off, which is the safe direction to fail in.
    const { data: ruleRow } = await supabase.from('league_settings').select('open_player_rule').limit(1).maybeSingle();
    const openPlayerRule = ruleRow?.open_player_rule === true;

    // Is the player being challenged shielded right now?
    //
    // Both readings of the rule answer that, in different ways - with the
    // open-player rule on, a challenger who did not skip anybody is protected;
    // with it off, nobody may be challenged twice at once. Both now live in
    // protected_player_ids(), so this asks once and reads the refusal straight
    // back instead of keeping a second copy of either predicate here.
    //
    // The ladder asks that same function before it draws a Challenge button.
    // That is the point of moving it: a player should not be able to reach
    // this refusal by tapping a button the app offered them.
    //
    // Fail CLOSED, as every guard here does - a failed read must never read as
    // a clear board.
    const { data: shieldRows, error: shieldError } = await supabase.rpc('protected_player_ids');
    if (shieldError) {
      console.error('[create-challenge protection]', shieldError);
      return new Response(JSON.stringify({ error: 'Could not work out who is free to be challenged right now. Please try again.' }), { status: 503, headers: corsHeaders });
    }
    const shield = ((shieldRows ?? []) as { player_id: string; detail: string }[])
      .find((r) => r.player_id === challenged_player_id);
    if (shield) return new Response(JSON.stringify({ error: shield.detail }), { status: 409, headers: corsHeaders });

    let challengerKeepsProtection = true;

    if (openPlayerRule) {
      // Whether the CHALLENGER keeps their own protection is a different
      // question from whether the target has any, and it stays here: it
      // depends on this challenger's range, which the database does not know.
      // Only the "who is shielded" half moved out to protected_player_ids().
      //
      // "Engaged" comes from engaged_player_ids() in the database, not from a
      // second copy of the status lists here. Two copies is precisely how this
      // repo has drifted before, and the migration that defines that function
      // promises it is the single definition — so use it.
      const engagedRes = await supabase.rpc('engaged_player_ids');

      // Fail CLOSED. The scan below is a "nobody else was free" test, so a
      // failed read would otherwise read as a clear board and hand out
      // protection that was never earned.
      if (engagedRes.error) {
        console.error('[create-challenge open-player]', engagedRes.error);
        return new Response(JSON.stringify({ error: 'Could not work out who is free to be challenged right now. Please try again.' }), { status: 503, headers: corsHeaders });
      }

      const engaged = new Set(
        ((engagedRes.data ?? []) as { player_id: string }[]).map((r) => r.player_id),
      );

      // An "open player" is active, inside my range, and not already tied up.
      // A cooldown does NOT take somebody out of this pool: cooldowns stop you
      // ISSUING a challenge, never accepting one, so a player sitting one out
      // still has to defend and is still a target you could have taken.
      let openPlayerAvailable = false;
      for (const [pid, rank] of activeRankByPlayer) {
        if (pid === challenger.id) continue;
        if (canChallenge(myRank, rank, challengeRange)) continue; // truthy = a reason it is NOT allowed
        if (engaged.has(pid)) continue;
        openPlayerAvailable = true;
        break;
      }

      challengerKeepsProtection = !(engaged.has(challenged_player_id) && openPlayerAvailable);
    }

    // ---- Preview stops here, one line before the first write ---------------
    //
    // A challenger who goes after somebody already tied up, while an open
    // player sat in their range, gives up their own protection: anyone below
    // them may challenge them while they wait. That is a real cost and the app
    // used to charge it silently -- the number came back in this function's
    // response, after the challenge had already been issued.
    //
    // Why this is not a SQL function like protected_player_ids(). That one
    // could move, because it reads only `challenges` and `league_settings`,
    // which every signed-in player can already read. This question cannot:
    // it needs `matches`, whose RLS is participant-only, and it needs the
    // challenger's active rank and range. engaged_player_ids() was locked to
    // the service role in 20260817144000 for exactly that reason, and the
    // range rules already exist in two places (src/lib/ladder.ts and the
    // canChallenge above). A third copy in SQL is how this app's rules have
    // drifted before.
    //
    // So the preview is not a second implementation at all. It is this
    // function, run to the same point by the same guards, stopped before it
    // writes. The warning cannot disagree with the outcome, because it IS the
    // outcome.
    //
    // Not perfectly read-only: expire_stale_challenges() ran further up. That
    // is deliberate -- it is idempotent housekeeping that also runs hourly on
    // cron, and skipping it would have the preview read a staler board than
    // the send would.
    if (isPreview) {
      return new Response(JSON.stringify({
        preview: true,
        challenger_protected: challengerKeepsProtection,
        protection_warning: challengerKeepsProtection
          ? null
          : 'They are already tied up in a challenge, and someone else in your range is free right now. Challenge them anyway and you give up your own protection: while you wait to play, anyone below you can challenge you.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const expiresAt = new Date(Date.now() + responseHours * 3600 * 1000).toISOString();
    const challengeRow: Record<string, unknown> = { challenger_id: challenger.id, challenged_id: challenged_player_id, discipline, race_length, status: 'pending', expires_at: expiresAt };
    // Only written while the rule is live, so this function keeps working on a
    // database that has not had the column added yet.
    if (openPlayerRule) challengeRow.challenger_protected = challengerKeepsProtection;
    const { data: challenge, error: insertErr } = await supabase.from('challenges').insert(challengeRow).select().single();
    if (insertErr) throw insertErr;

    const { data: challengerStats } = await supabase.from('player_season_stats').select('challenges_issued').eq('player_id', challenger.id).single();
    if (challengerStats) await supabase.from('player_season_stats').update({ challenges_issued: challengerStats.challenges_issued + 1 }).eq('player_id', challenger.id);

    const { data: challengedStats } = await supabase.from('player_season_stats').select('challenges_received').eq('player_id', challenged_player_id).single();
    if (challengedStats) await supabase.from('player_season_stats').update({ challenges_received: challengedStats.challenges_received + 1 }).eq('player_id', challenged_player_id);

    await Promise.all([
      supabase.from('player_discipline_stats').upsert({ player_id: challenger.id, discipline }, { onConflict: 'player_id,discipline', ignoreDuplicates: true }),
      supabase.from('player_discipline_stats').upsert({ player_id: challenged_player_id, discipline }, { onConflict: 'player_id,discipline', ignoreDuplicates: true }),
    ]);

    const [dStatsC, dStatsD] = await Promise.all([
      supabase.from('player_discipline_stats').select('challenges_issued').eq('player_id', challenger.id).eq('discipline', discipline).single(),
      supabase.from('player_discipline_stats').select('challenges_received').eq('player_id', challenged_player_id).eq('discipline', discipline).single(),
    ]);
    if (dStatsC.data) await supabase.from('player_discipline_stats').update({ challenges_issued: dStatsC.data.challenges_issued + 1 }).eq('player_id', challenger.id).eq('discipline', discipline);
    if (dStatsD.data) await supabase.from('player_discipline_stats').update({ challenges_received: dStatsD.data.challenges_received + 1 }).eq('player_id', challenged_player_id).eq('discipline', discipline);

    const { data: challengerPlayer } = await supabase.from('players').select('full_name').eq('id', challenger.id).single();
    await supabase.from('notifications').insert({
      player_id: challenged_player_id,
      type: 'challenge_received',
      title: `${challengerPlayer?.full_name} challenged you!`,
      body: `${discipline} - Race to ${race_length}. You have ${responseHours} hours to respond.`,
      reference_id: challenge.id,
      reference_type: 'challenge',
    });
    await sendPush(supabase, challenged_player_id, `${challengerPlayer?.full_name} challenged you!`, `${discipline} - Race to ${race_length}. Tap to respond.`, '/challenges');

    const { data: challengedPlayer } = await supabase.from('players').select('full_name').eq('id', challenged_player_id).single();
    await supabase.from('activity_feed').insert({
      event_type: 'challenge_issued',
      headline: `${challengerPlayer?.full_name} challenged ${challengedPlayer?.full_name} to ${discipline}!`,
      detail: `Race to ${race_length} · #${myPos} → #${theirPos} · responds within ${responseHours} hours`,
      actor_player_id: challenger.id,
    });

    return new Response(JSON.stringify({ challenge_id: challenge.id, challenger_protected: challengerKeepsProtection }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('create-challenge failed', e);
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), { status: 500, headers: corsHeaders });
  }
});

