import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const migrationDir = 'supabase/migrations';
const migrationNames = readdirSync(join(root, migrationDir));
const readMigration = (fragment) => {
  const name = migrationNames.find((file) => file.includes(fragment));
  assert.ok(name, `expected a migration matching "${fragment}"`);
  return read(join(migrationDir, name));
};

// The migrations explain themselves at length and the prose quotes SQL the
// assertions forbid. Match statements, not commentary.
const sqlOnly = (text) =>
  text.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const jobs        = sqlOnly(readMigration('scheduled_jobs_and_match_day_reminders'));
const announce    = sqlOnly(readMigration('league_announcements'));
const openPlayer  = sqlOnly(readMigration('open_player_protection'));
// The current definition of the function, not its first cut: 20260910074500
// CREATE OR REPLACEs the whole thing, so the assertions below pin what is
// actually live rather than superseded history.
const protectedIds = sqlOnly(readMigration('protection_expiry_guard'));

const createChallenge = read('supabase/functions/create-challenge/index.ts');
const protectionHook  = read('src/hooks/useProtectedPlayers.ts');
const submitResult    = read('supabase/functions/submit-result/index.ts');
const layout          = read('src/components/Layout.tsx');
const dbTypes         = read('src/types/database.ts');
const notificationsPage = read('src/pages/NotificationsPage.tsx');
const adminPage       = read('src/pages/AdminPage.tsx');

// --- K3: an admin enters a result for players who do not use the app --------

test('admin entry checks the admin role before it writes anything', () => {
  const fn = submitResult.slice(submitResult.indexOf('async function handleAdminEntry'));
  const roleCheck = fn.indexOf("['admin', 'super_admin'].includes");
  const firstWrite = fn.indexOf('.insert(');
  assert.ok(roleCheck > -1, 'handleAdminEntry must check the role');
  assert.ok(firstWrite > -1, 'handleAdminEntry must write something');
  assert.ok(roleCheck < firstWrite, 'the role check must come before the first insert');
});

test('admin entry reuses confirmResult rather than restating the result rules', () => {
  // The ladder swap, win/loss stats, streaks and cooldowns all live in
  // confirmResult. A second copy is how the two halves of this app drift apart.
  // The challenge counters are a different thing: those belong to creating a
  // challenge, and are mirrored from create-challenge on purpose.
  const fn = submitResult.slice(submitResult.indexOf('async function handleAdminEntry'));
  const body = fn.slice(0, fn.indexOf('\nserve('));
  assert.match(body, /await confirmResult\(/);
  assert.doesNotMatch(body, /cascade_ranking_after_win/, 'must not re-implement the ladder move');
  assert.doesNotMatch(body, /from\('cooldowns'\)/, 'must not re-implement cooldowns');
  for (const counter of ['wins:', 'losses:', 'current_streak', 'best_streak']) {
    assert.ok(!body.includes(counter), `must not re-implement ${counter}`);
  }
  // The only stats it touches are the two challenge counters.
  const statsWrites = body.match(/from\('player_season_stats'\)/g) ?? [];
  assert.ok(statsWrites.length > 0, 'challenge counters must be kept');
  assert.match(body, /challenges_issued/);
  assert.match(body, /challenges_received/);
});

test('admin entry keeps challenger as player1, so the ladder moves the right way', () => {
  // confirmResult reads winnerIsChallenger off match.player1_id === winnerId,
  // and cascade_ranking_after_win only moves anyone when the winner started
  // below. Swapping these two would silently invert every admin-entered result.
  const fn = submitResult.slice(submitResult.indexOf('async function handleAdminEntry'));
  assert.match(fn, /player1_id: challengerId/);
  assert.match(fn, /player2_id: challengedId/);
  assert.match(submitResult, /const winnerIsChallenger = match\.player1_id === winnerId/);
});

test('admin entry supplies every column the match table demands', () => {
  // matches.venue and matches.scheduled_at are NOT NULL, and challenge_id is a
  // NOT NULL unique FK — a missing one fails at Carl's first use, not here.
  const fn = submitResult.slice(submitResult.indexOf('async function handleAdminEntry'));
  for (const column of ['challenge_id:', 'venue,', 'scheduled_at:', 'discipline,', 'race_length:']) {
    assert.ok(fn.includes(column), `admin entry must set ${column}`);
  }
  assert.match(fn, /if \(!venue\) return bad\(/, 'venue is NOT NULL, so it must be required up front');
});

test('admin entry does not invent a match fee', () => {
  // A player who does not use the app pays Carl in person. Recording a payment
  // method here would put a false line in the treasury.
  const fn = submitResult.slice(submitResult.indexOf('async function handleAdminEntry'));
  const body = fn.slice(0, fn.indexOf('\nserve('));
  assert.doesNotMatch(body, /recordMatchFeePayments|recordSubmittedMatchFees|payment_method/);
});

test('the admin entry screen is wired into the admin page', () => {
  assert.match(adminPage, /RecordMatchTab/);
  assert.match(adminPage, /tab === 'record'/);
});

// --- B5 / L4 / L5: the open-player rule ------------------------------------

test('the open-player rule is switchable and fails off', () => {
  // It reads three free-text answers, so Carl gets a switch. If the column is
  // missing the select fails, ruleRow is null, and the old rule stands.
  assert.match(createChallenge, /from\('league_settings'\)\.select\('open_player_rule'\)/);
  assert.match(createChallenge, /openPlayerRule = ruleRow\?\.open_player_rule === true/);
  assert.match(openPlayer, /ADD COLUMN IF NOT EXISTS open_player_rule boolean NOT NULL DEFAULT true/);
});

// These three used to assert against create-challenge, which worked the
// predicate out inline. It moved into protected_player_ids() so the challenge
// screen could ask the same question before drawing a button, and the rule is
// pinned at its new home. The behaviour asserted has not changed.

test('protection belongs to the challenger, never to the player challenged', () => {
  // B5 is "Many": the player you challenge stays challengeable, which is what
  // lets somebody go after the winner or the loser of an arranged match. Only
  // the rule-OFF reading — one incoming challenge at a time — looks at the
  // challenged player, and only while the rule is off.
  assert.match(protectedIds, /c\.challenger_id AS player_id[\s\S]*?WHERE rule\.open_player_rule/);
  assert.match(protectedIds, /c\.challenged_id AS player_id[\s\S]*?WHERE NOT rule\.open_player_rule/);
  assert.match(protectedIds, /c\.challenger_protected IS DISTINCT FROM false/);
  // create-challenge still WRITES the column — deciding whether a new
  // challenger keeps their own shield needs their range, which the database
  // does not know — but it no longer keeps a second copy of the read.
  assert.match(createChallenge, /challengeRow\.challenger_protected = challengerKeepsProtection/);
  assert.doesNotMatch(createChallenge, /challenger_protected !== false/);
});

test('protection runs out when the deadline to actually play does', () => {
  // Only 'pending' challenges are ever expired, so an accepted-but-never-played
  // challenge would otherwise shield its challenger forever and freeze everyone
  // below them on the list. match_deadline is read BEFORE expires_at: an
  // accepted challenge already has expires_at in the past, so the other order
  // would strip the shield off every scheduled match on the board.
  assert.match(protectedIds, /COALESCE\(c\.match_deadline, c\.expires_at\) IS NULL/);
  assert.match(protectedIds, /COALESCE\(c\.match_deadline, c\.expires_at\) > now\(\)/);
});

test('the rule reading fails the same way on both sides', () => {
  // create-challenge reads a missing settings row as the rule being OFF and
  // calls that the safe direction. The function has to agree, or the two would
  // disagree about who is protected at the worst possible moment.
  assert.match(protectedIds, /COALESCE\(\(SELECT s\.open_player_rule FROM public\.league_settings s LIMIT 1\), false\)/);
  assert.match(createChallenge, /openPlayerRule = ruleRow\?\.open_player_rule === true/);
});

test('a failed read refuses the challenge instead of handing out protection', () => {
  // Every guard in this block is a "nobody is in the way" test, so failing open
  // would read as a clear board and grant protection nobody earned.
  assert.match(createChallenge, /if \(shieldError\)[\s\S]*?status: 503/);
  assert.match(createChallenge, /if \(engagedRes\.error\)[\s\S]*?status: 503/);
});

test('a lapsed pending challenge stops shielding before the sweep runs', () => {
  // create-challenge calls expire_stale_challenges() before it checks, so it
  // never sees a 'pending' challenge whose expires_at has passed. The client
  // cannot run that sweep and the cron is hourly, so the rule-OFF branch has to
  // apply the same predicate itself or it would invent a refusal the server
  // would not make -- the opposite of failing open.
  assert.match(protectedIds, /NOT \(c\.status = 'pending' AND c\.expires_at <= now\(\)\)/);
  // The rule-ON branch needs no such guard: its deadline test already excludes
  // a lapsed pending challenge.
  assert.match(protectedIds, /COALESCE\(c\.match_deadline, c\.expires_at\) > now\(\)/);
});

test('the ladder and the server ask the same question', () => {
  // The whole point of moving the predicate: a player must not be able to reach
  // the refusal by tapping a button the app offered them.
  assert.match(createChallenge, /rpc\('protected_player_ids'\)/);
  assert.match(protectionHook, /rpc\('protected_player_ids'\)/);
  // The refusal wording comes back with the answer rather than being retyped.
  assert.match(createChallenge, /error: shield\.detail/);
});

test('signed-out visitors are kept out of the protection lookup', () => {
  // The guest surface is six views and nothing else, and a guest cannot
  // challenge anybody.
  assert.match(protectedIds, /REVOKE ALL ON FUNCTION public\.protected_player_ids\(\) FROM PUBLIC, anon/);
  assert.match(protectedIds, /GRANT EXECUTE ON FUNCTION public\.protected_player_ids\(\) TO authenticated, service_role/);
  assert.doesNotMatch(protectedIds, /SECURITY DEFINER/);
});

test('skipping an open player is what costs you protection', () => {
  assert.match(
    createChallenge,
    /challengerKeepsProtection = !\(engaged\.has\(challenged_player_id\) && openPlayerAvailable\)/,
  );
  // canChallenge returns a REASON when not allowed, so a truthy result must skip.
  assert.match(createChallenge, /if \(canChallenge\(myRank, rank, challengeRange\)\) continue;/);
});

test('who counts as engaged is defined once, in the database', () => {
  // The migration that adds engaged_player_ids() promises it is the single
  // definition. A second copy of the status lists in TypeScript is this repo's
  // documented failure mode, reproduced inside the change meant to avoid it.
  assert.match(createChallenge, /supabase\.rpc\('engaged_player_ids'\)/);
  assert.doesNotMatch(createChallenge, /const ACTIVE_MATCH =/);
});

test('a player mid-confirmation counts as tied up', () => {
  // submit-result parks a match at 'confirming' while it works out the result,
  // and a throw in there leaves it stuck. Either way both players are busy.
  const washFix = sqlOnly(readMigration('wash_closes_the_match_and_confirming_counts'));
  assert.match(washFix, /'submitted', 'confirming', 'disputed'/);
});

test('a washed challenge does not leave its match alive forever', () => {
  // respond-to-challenge creates the match on accept; admin_resolve_wash used
  // to leave that row 'scheduled' for good, which under the open-player rule
  // marked both players permanently engaged.
  const washFix = sqlOnly(readMigration('wash_closes_the_match_and_confirming_counts'));
  assert.match(washFix, /UPDATE public\.matches\s*\n?\s*SET status = 'cancelled'/);
  assert.match(washFix, /'cancelled'::text/, 'cancelled must be a legal match status');
});

test('a player on cooldown is still an open player', () => {
  // Cooldowns stop you ISSUING a challenge; none of them stop you accepting
  // one. A player sitting one out still has to defend, so they are still a
  // target you could have taken, and skipping them still costs you protection.
  assert.match(createChallenge, /if \(engaged\.has\(pid\)\) continue;/);
  assert.doesNotMatch(createChallenge, /onCooldown\.has\(pid\)/);
});

test('the challenger is told about their own cooldown first', () => {
  // Otherwise somebody sitting out a wash is sent hunting for a different
  // opponent by a message about the first one being protected.
  const cooldownAt = createChallenge.indexOf("Every cooldown blocks issuing a challenge");
  const openPlayerAt = createChallenge.indexOf('Who may be challenged (questionnaire B5');
  assert.ok(cooldownAt > -1 && openPlayerAt > -1);
  assert.ok(cooldownAt < openPlayerAt, 'the cooldown check must come first');
});

test('the protection flag is only written when the rule is live', () => {
  // Otherwise this function breaks against a database that has not had the
  // column added yet.
  assert.match(createChallenge, /if \(openPlayerRule\) challengeRow\.challenger_protected = challengerKeepsProtection;/);
});

// --- H1 / H2: reminders, expiry and announcements ---------------------------

test('challenge expiry runs on a clock, not by luck', () => {
  // It used to fire only as a side effect of somebody creating a challenge, so
  // on a quiet week nothing expired and no forfeit was ever recorded.
  assert.match(jobs, /cron\.schedule\(\s*\n?\s*'tof-expire-challenges'/);
  assert.match(jobs, /expire_stale_challenges\(\)/);
});

test('match-day reminders cannot double-send', () => {
  assert.match(jobs, /cron\.schedule\(\s*\n?\s*'tof-match-day-reminders'/);
  assert.match(jobs, /NOT EXISTS \(/);
  assert.match(jobs, /interval '20 hours'/);
  assert.match(jobs, /'match_day_reminder'/);
});

test('announcements are admin-only and closed to anon', () => {
  assert.match(announce, /IF NOT public\.is_league_admin\(\) THEN/);
  assert.match(announce, /REVOKE ALL ON FUNCTION public\.broadcast_league_announcement\(text, text\)\s*\n?\s*FROM PUBLIC, anon, service_role/);
  assert.match(announce, /SET search_path = public/);
});

test('an announcement only reaches players who can actually receive it', () => {
  // An unclaimed roster row has no account behind it, so a notification there
  // is written to nobody.
  assert.match(announce, /WHERE p\.profile_id IS NOT NULL/);
});

// --- L3: a new player sees their own record ---------------------------------

test('a newly claimed player lands on their own record', () => {
  assert.match(layout, /const justClaimed = localStorage\.getItem\('toc-new-user'\) === '1'/);
  assert.match(layout, /navigate\(justClaimed \? `\/player\/\$\{player\.id\}` : '\/'/);
});

// --- The repo's signature failure mode: SQL moved, TypeScript did not -------

test('the new columns exist in the TypeScript types too', () => {
  assert.match(dbTypes, /open_player_rule: boolean;/);
  assert.match(dbTypes, /challenger_protected: boolean;/);
});

test('every notification type the app now writes has something to render it', () => {
  const written = new Set();
  for (const source of [jobs, announce, createChallenge, submitResult]) {
    for (const m of source.matchAll(/type: '([a-z_]+)'|'(league_announcement|match_day_reminder)'/g)) {
      const t = m[1] ?? m[2];
      if (t) written.add(t);
    }
  }
  // Only the two this batch introduces are asserted; the rest predate it.
  for (const t of ['league_announcement', 'match_day_reminder']) {
    assert.ok(written.has(t), `${t} should be written by this batch`);
    assert.ok(
      notificationsPage.includes(`${t}:`),
      `${t} has no icon in NotificationsPage, so it renders as a generic 8-ball`,
    );
  }
});

// --- What the adversarial review caught ------------------------------------

test('admin entry finishes an existing challenge instead of racing it', () => {
  // The critical one. If A challenged B in the app and they played it offline,
  // writing a second challenge leaves the first one live — and the new hourly
  // expiry cron then forfeits it, moving the ladder again and overturning the
  // result Carl just typed in.
  const fn = submitResult.slice(submitResult.indexOf('async function handleAdminEntry'));
  const body = fn.slice(0, fn.indexOf('\nserve('));
  assert.match(body, /\.in\('status', \['pending', 'accepted', 'scheduled', 'in_progress'\]\)/);
  assert.match(body, /reusedChallenge = true/);
  // And it must take the live challenge's orientation, since the ladder maths
  // keys off who actually called whom.
  assert.match(body, /challengerId = existing\.challenger_id/);
  assert.match(body, /challengedId = existing\.challenged_id/);
});

test('the same match cannot be recorded twice in a row', () => {
  const fn = submitResult.slice(submitResult.indexOf('async function handleAdminEntry'));
  assert.match(fn, /status', 'confirmed'\)/);
  assert.match(fn, /looks like the same match again/);
});

test('an inactive player cannot be moved up by an admin-entered result', () => {
  const fn = submitResult.slice(submitResult.indexOf('async function handleAdminEntry'));
  assert.match(fn, /is_active/);
  assert.match(fn, /marked inactive/);
  // And the picker should not offer them in the first place.
  const tab = read('src/components/admin/RecordMatchTab.tsx');
  assert.match(tab, /\.filter\(\(r\) => r\.player\.is_active\)/);
});

test('admin entry validates against league settings, not just non-empty', () => {
  // The DB CHECK lists would otherwise reject the insert and surface to Carl as
  // an opaque 500 with no clue which field was wrong.
  const fn = submitResult.slice(submitResult.indexOf('async function handleAdminEntry'));
  assert.match(fn, /disciplines\.includes\(discipline\)/);
  assert.match(fn, /venues\.includes\(venue\)/);
  assert.match(fn, /raceLength < minRace/);
});

test('a half-written admin match cannot become a phantom dispute', () => {
  // Both submitted-detail column sets are filled, so if this dies mid-flight
  // and a player later submits against the row, isCompleteSubmission passes
  // rather than dumping a game nobody disputed into Carl's queue.
  const fn = submitResult.slice(submitResult.indexOf('async function handleAdminEntry'));
  for (const col of [
    'player1_submitted_winner_id', 'player2_submitted_winner_id',
    'player1_submitted_player1_score', 'player2_submitted_player2_score',
  ]) {
    assert.ok(fn.includes(col), `${col} must be set`);
  }
});
