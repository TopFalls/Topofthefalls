# TOF change log — what the editing room shipped

Every change Carl requests goes through `.claude/skills/tof-edit/SKILL.md` and
lands here. Newest first. This exists so Chase can stay out of the request loop
and still audit it afterward in one pass.

One entry per request. Keep it short — the detail is in the commit.

```
## YYYY-MM-DD — <outcome in one line>

**Carl asked:** <verbatim, however he phrased it>
**Shipped:** <what the app does now>
**Files:** <the two or three that matter>
**Commit:** <sha> · **Deploy:** green / rolled back
**Gates:** build ✓ tests ✓ <+ any agent review run>
**Flags:** <assumption made, canon moved, or stop condition hit — else "none">
```

---

## 2026-09-11 — A loss costs exactly one spot, and the list says which way is up

**Carl asked:** "A player can never lose more than one spot for a loss. But a
lesser ranked player challenging a higher ranked player gets the spot of that
player that was higher, and the higher player always only moves down one. They
can never move down less than one. And by down, I mean in a worse position. We
need to make clear verbiage that moving down on the list isn't lower in number
ranking, it's higher, and moving up on the list is towards number one."

**The app was swapping the two players.** The winner took the loser's spot and
the loser took the winner's. When they are next to each other that is the same
thing as the rule, which is why it went unnoticed for so long. When they are
not, the loser fell exactly as far as the winner climbed — and spots 11 and
below may challenge **two** up, so a two-spot fall was a legal, routine result.

**Measured before writing a line.** Of 38 forfeits that moved the ladder, 24
dropped the loser one spot and **14 dropped them two**. Every one of the 14 was
a challenge spanning more than one position. This is separate from yesterday's
forfeit loop and was hiding underneath it: the loop explained why the ladder
churned, this explains why individual results were wrong.

**Shipped:** `cascade_ranking_after_win` now rotates instead of swapping.

```
before   #43 Dan    #44 Jo     #45 Kurt
Kurt challenges Dan two up and wins
after    #43 Kurt   #44 Dan    #45 Jo
```

The winner takes the spot they challenged, the loser moves down one, and anyone
the winner passed moves down one as well. It is the single place the ladder
moves after a win — played matches, admin-settled disputes and forfeits all call
it — so one function covers all three. A successful defence still moves nobody.

**The reversal did need a change, and the first draft of this entry said it
didn't.** The migration review caught it. `reverse_challenge_decline_forfeit`
has to invert whatever the forfeit recorded, and the rotation changes the shape
of that recording: a swap-era event stored the loser on the challenger's old
spot, a rotation-era event stores them one below their own. Those agree at a gap
of one and diverge above it, and the function could not tell them apart — its
fast path keyed on the swap pattern, so a swap-era two-spot event would have
been undone as a rotation, dropping the challenger a spot instead of returning
them to their own and pulling down an untouched player in between.

Seven such events are on the live project. Six are already refused because the
positions have drifted from Mike's reorders. One — Kurt Mueller and Dan Patton,
recorded at 02:07 that morning — was still exactly on its recorded positions and
would have gone through. So `reverse_challenge_decline_forfeit` now refuses any
event whose recorded move was not a one-spot drop, naming the date the rule
changed and pointing the admin at the Rankings tab, and the fast path is gone so
the block shift is the only route. Refusing is the right answer: the alternative
is silently rearranging three people on a guess.

**A failed challenge moves nobody, and the first draft of this got that wrong.**
Carl, reading it back: *"There's times where a loss doesn't change the list at
all, and that's when a player lower on the list challenging a higher ranked
player loses. Nothing changes in that situation."* The code was already right —
`cascade_ranking_after_win` returns early when the winner is already ahead — but
the wording said a loss "never costs less than one spot", which is only true of
a defender beaten from below. A challenger who loses stays exactly where they
are; the defender does not climb for holding the spot either. Corrected in the
rules text, the migration, the canon and the test names, and the case now has
its own test across every legal gap. Losing does still carry a cooldown — defend
or wait seven days — but that is a wait, not a position.

**The verbiage.** The rules text now opens with direction, because every rule
under it depends on which way the list runs and "higher" pulls both ways: *"Up
the list means towards #1, and a smaller number. Down the list means away from
#1, and a bigger number."* Then the two outcomes, in plain terms: win and you
take the spot, everyone you passed drops one; lose and nothing changes at all.
Both are now canon in `CLAUDE.md` as well.

**Files:** `supabase/migrations/20260911120000_a_loss_costs_exactly_one_spot.sql`,
`supabase/migrations/20260911130000_reversal_refuses_what_it_cannot_undo.sql`,
`src/config/league.ts`, `CLAUDE.md`, `test/ladder-one-spot.test.mjs`
**Gates:** build ✓ · tests 174/174 ✓ (22 new — the rotation is modelled in JS
and checked across every legal gap, so the arithmetic is tested rather than the
SQL eyeballed) · `supabase-migration-reviewer` run twice, once per migration

**Flags:**
- **History is not repaired.** 14 past results moved a loser two spots instead
  of one, but Mike has hand-corrected the ladder five times since, so the
  current standings are what he intends. Replaying old results over a ladder
  that has been manually adjusted would be guesswork on top of a correct board.
  The rule applies from here.
- **One old forfeit can no longer be undone by the button.** Kurt Mueller and
  Dan Patton, 2026-09-11 02:07 — it was recorded under the swap rule over a
  two-spot gap, so there is no honest way to reverse it automatically. The
  button now says so and sends the admin to the Rankings tab. Six other
  swap-era events were already un-reversible for an unrelated reason.
- **The two migrations go on together and in order.** `20260911130000` applied
  without `20260911120000` would refuse events the live code is still making.
- This is a rule Carl had never written down, and the app had no canon for it
  either. It is canon now.

---

## 2026-09-10 — The ladder loop: a reversed forfeit no longer comes back an hour later

**Carl asked:** "Yesterday a player at 98th position challenged the 97th position
and they kept score in the app and when the 98 position one won it moved them up
two spots instead of just one to 97. That is an incorrect move and they should
have just swapped spots, advancing the winner one position because they only
challenged one position ahead of them."

**The swap was never the problem.** `cascade_ranking_after_win` is a clean
exchange and was doing exactly that. The extra spot came from a second event
nobody asked for, in a loop between the hourly sweep and the admin undo button:

1. `expire_stale_challenges()` forfeits every challenge that is `pending` with
   `expires_at` in the past, and a forfeit swaps the challenger up the ladder.
2. An admin judges one of those wrong and hits **Reverse Decline**.
3. The reversal restores `status = 'pending'` and leaves `expires_at` alone —
   necessarily still in the past, because expiring is how the challenge reached a
   forfeit in the first place.
4. That is the sweep's exact predicate. The next hourly run forfeits it again.

So a player who won a match legitimately (one spot, correct) could also collect a
spot from a stale challenge of their own being force-forfeited underneath them.

**Read off the live database before a line was written:** 39
`challenge_decline_forfeit_applied` and 24 `challenge_decline_forfeit_reversed`
inside three days; Ron DeWitt/Wade Thompson, Dean Mueller/Kelly Gilligan and
Bryan Vaden/Carp Mazing each forfeited **three separate times**; all 16 affected
challenges past expiry, the earliest since 2026-09-05; and five manual
`rankings.admin_reorder` passes by Mike cleaning up after it.

**Shipped:** reversing a forfeit now gives the challenge a real response window
again — `now() + challenge_response_hours` (48) — but only when the old one had
already lapsed. A challenge still inside its window keeps its original deadline,
so an admin touching a live challenge cannot hand it a second full window. That
makes Reverse Decline mean what the admin intends: this challenge still stands,
and the challenged player has actual time to answer.

**How it was built matters.** The function is 220 lines of live, load-bearing
code. Rather than retype it, the deployed definition was extracted
programmatically from `20260814121000_ladder_swap_on_win.sql` and exactly one
statement replaced. Verified against `pg_proc.prosrc` first that the deployed
function contained the old statement verbatim and mentioned `expires_at`
nowhere at all.

**Files:** `supabase/migrations/20260910190000_reversed_forfeit_gets_a_real_window.sql`,
`test/forfeit-reversal.test.mjs`
**Gates:** build ✓ · tests 152/152 ✓ (five new, pinning the loop shut) ·
`supabase-migration-reviewer` run

**Flags:**
- **Dormant, not dead, until this lands.** Zero pending challenges are currently
  past expiry, so nothing is queued to fire and the ladder is stable as Mike left
  it. It re-arms the moment anyone reverses a forfeit, so Mike should hold off on
  Reverse Decline until this is applied.
- The positions Carl quoted were an example, not the actual pairing — he said so
  when asked. The systemic evidence above is what the diagnosis rests on.
- Not from Carl's original list. This surfaced separately and is the most
  damaging of anything reported so far, because it silently rewrites the ladder.
## 2026-09-10 — A player is told what a challenge will cost before they send it

**Chase asked** for this, off the open-items list rather than from Carl. It is
the other half of the protection rule, and the half that was left flagged when
the first half shipped this morning.

**Shipped:** Under the open-player rule, going after somebody already tied up in
a match while an open player sat in your range gives up your own protection --
anyone below you may challenge you while you wait. The app charged that
silently. The number came back in the response, after the challenge had already
been issued, and nothing ever showed it to the player. The confirm step now says
so before they send, in plain terms: they are already tied up, someone else in
your range is free, challenge them anyway and anyone below you can come after
you while you wait.

It warns; it does not block. Taking that trade is a legitimate move -- you might
want that particular match -- and the point is that it should be a choice rather
than a surprise.

**How, and why not the way the first half was built.** This morning's half moved
its predicate into SQL so the ladder could ask it directly. That worked because
it reads only `challenges` and `league_settings`, which every signed-in player
can already read. This question cannot move: it needs `matches`, whose RLS is
participant-only, and it needs the challenger's own active rank and range.
`engaged_player_ids()` was deliberately locked to the service role in
`20260817144000` for exactly that reason, and the range rules already exist in
two places. A third copy in SQL is how this app's rules have drifted before.

So there is no second implementation. `create-challenge` gained a preview mode:
the same function, run to the same decision by the same guards, stopped one line
before the first write, reporting the very variable the insert would have
written. The warning cannot disagree with what Send does, because it is what
Send decided.

**Files:** `supabase/functions/create-challenge/index.ts`,
`src/pages/ChallengePage.tsx`
**Commit:** see below · **Deploy:** edge function redeployed and verified;
frontend ships on merge
**Gates:** build ✓ · tests 150/150 ✓ · lint clean on changed files ·
`demo-readiness-checker` run

**Flags:**
- **The preview is not perfectly read-only.** `expire_stale_challenges()` runs
  earlier in the function and is a write. Kept deliberately: it is idempotent
  housekeeping that also runs hourly on cron, and skipping it would have the
  preview read a staler board than the send would. The test suite pins the
  preview's return above every other write.
- **What the preview tells a player, and why that is not a leak.** A "you would
  lose it" answer reveals that the target is engaged. That is not new: every
  challenge row is readable by the whole league, every match hangs off a
  challenge whose status tracks it, and issuing the challenge returns the same
  answer anyway. The one real difference is rate: sending is capped at two a
  week, previewing is not. The probe space is the one or two players directly
  above you, whose challenge status is already public, so the exposure is
  nil in practice. Recorded as reasoning rather than proof.
- Still true, and still worth knowing: nobody in live play has ever lost
  protection. Every live challenge carries `challenger_protected = true`. This
  warning may go a long time without firing, which is the good outcome.

---

## 2026-09-10 — The ladder stops offering a Challenge button that cannot work

**Chase asked** for this one, off the open-items list rather than from Carl: the
challenge screen did not know who was protected, so a player could tap Challenge
and get a refusal.

**Shipped:** A player shielded by a live challenge of their own no longer shows a
Challenge button. The reason shows in its place, on the list, on their profile,
and on the challenge screen, which now refuses up front instead of walking
somebody through three steps to a dead end. When this went out, 18 of the people
on the list were carrying a button that could not work.

**How, and the choice behind it.** The obvious build is to work protection out in
the browser. That would have been a second copy of a subtle, live rule in
TypeScript, which is how this app's rules have drifted before -- it is why
`engaged_player_ids()` exists at all, and its comment promises to be the single
definition so "the edge function and any future SQL cannot drift apart". So the
predicate moved into SQL instead. `protected_player_ids()` answers it once, with
the reason attached: a short label for the list, and the full sentence for the
screens with room for one. `create-challenge` asks the same function and returns
that sentence as its refusal, so the words a player reads have one source too.
Both readings of the rule live there -- the open-player shield when the rule is
on, one incoming challenge at a time when it is off -- and the edge function
carries neither predicate any more.

On the client the answer arrives as another eligibility reason, so the machinery
that already explains "Out of range" and "Inactive" explains this too. A
positional reason still wins, because out of range is the more basic fact and
does not change when someone else's match is played.

**The two sides fail in opposite directions, deliberately.** The server fails
closed, refusing when it cannot tell. The client fails open: the button appears
and the old refusal-at-submit happens. Failing closed in the browser would block
legitimate challenges over one dropped request, which is the worse mistake, and
it is only safe because the server enforces independently.

**Files:** `supabase/migrations/20260910071500_protected_player_ids.sql`,
`supabase/functions/create-challenge/index.ts`,
`src/hooks/useProtectedPlayers.ts`, `src/lib/ladder.ts`,
`src/pages/RankingsPage.tsx`, `src/pages/PlayerPage.tsx`,
`src/pages/ChallengePage.tsx`
**Commit:** 708f0b4 (PR #2) · **Deploy:** migration applied; `create-challenge`
v5 → v6, verified live -- its own CORS 200 proves it boots, and the deployed
source was read back and matched; frontend ships on merge through the Git
connection
**Gates:** build ✓ · tests 146/146 ✓ · lint clean on changed files ·
`supabase-migration-reviewer` and `demo-readiness-checker` both run

**Three more caught by `/code-review`, after it had shipped.** All three
verified in the code before acting, all three real:

- **The success screen was reachable then replaced.** `ChallengePage` checked
  protection above the "Challenge Sent!" screen. With the open-player rule off,
  the player you just challenged joins the protected set the moment your
  challenge lands, so within one 30-second refetch the confirmation would have
  turned into "they cannot be challenged". The guard now sits below the sent
  screen, with a comment saying why it must stay there.
- **The rule-OFF branch shielded lapsed challenges.** It mirrored
  `create-challenge`'s check exactly -- status only -- which is faithful to the
  line it copied but misses what runs immediately before it: the server calls
  `expire_stale_challenges()` first. The client cannot, and the cron is hourly,
  so for up to an hour the ladder would have hidden the button for somebody the
  server would happily let you challenge. That is a refusal invented on the
  client, the opposite of failing open. `20260910074500` applies the sweep's own
  predicate as a filter. Latent rather than live -- the rule is ON -- but the
  switch exists to be thrown.
- **The "Can Challenge" tab still listed protected players.** Keeping them
  visible with a badge was a deliberate choice on the full list, and the wrong
  one under a tab whose label promises otherwise. The filter routes through
  protection now; the explanation still lives on All Players.

**Gates after the fixes:** build ✓ · tests 147/147 ✓ · lint clean.

**What the migration review caught.** The first cut defaulted an empty
`league_settings` to the rule being ON, while `create-challenge` reads a missing
row as OFF and calls that the safe direction. The two would have disagreed about
who is protected. It also surfaced `20260817144000`, where a neighbouring
function's `SECURITY DEFINER` grant to `authenticated` had to be walked back for
returning more than the tables would show. This one reads only `challenges` and
`league_settings`, and `authenticated` already holds SELECT on both while `anon`
holds SELECT on neither -- both checked on the live database -- so it ships as
`SECURITY INVOKER` and can never return more than the caller could query by hand.

**Flags:**
- **The other half of this rule is still invisible.** A challenger who goes after
  an engaged player while an open one was available silently gives up their own
  shield and is never told. That is a bigger surprise than the refusal this
  fixes, and it needs the open-player scan on the client, which is a wider
  change. Not started.
- Nobody has ever lost protection in live play: every one of the 18 live
  challenges carries `challenger_protected = true`. So the silent-forfeit path
  above has not yet bitten anyone, and the shield logic has only ever been
  exercised in its generous direction.
- The three questionnaire tests that pinned this predicate now pin it at its new
  home rather than being deleted. One of them caught an over-strict assertion
  written during this change: `create-challenge` still *writes*
  `challenger_protected`, because deciding whether a new challenger keeps their
  own shield needs their range, which the database does not know. Only the read
  moved.

---

## 2026-09-09 — A Remove button that removes, and the near-miss that shaped it

**Carl asked:** "When I remove players still keeps them as inactive rather then
removing them."

**He was reading it exactly right.** There was no Remove. The only control on the
Players tab was a Deactivate/Activate toggle, which sets `is_active = false` and
leaves everything else alone — the player keeps their ladder position and stays
visible to the whole league and to signed-out visitors, struck through. Carl had
been pressing the only red button available and it did what it said.

**Shipped: two buttons that mean different things.**

- **Deactivate** stays exactly as it was. Somebody taking a break keeps their
  spot and comes back to it.
- **Remove from list** is new. It takes them off the ladder, closes the gap
  behind them, and the app decides what "off" means rather than the admin:
  no history at all → the row is deleted outright; any match, challenge,
  treasury entry or forfeit on record → the row stays, marked `removed_at`, off
  the ladder and out of every list. Those old matches are half of somebody
  else's win-loss record and deleting them would quietly change another
  player's numbers.

Both paths snapshot everything first into `player_removal_events`, and
`admin_restore_player` reads it back — the player, their ladder spot, stats,
feed, notifications and cooldowns. A removed player who still has a row gets a
**Put back** button on the same screen. That undo is not a nicety: a delete
without one would be a stop condition, and the pattern is the one
`20260806121000_admin_stats_reset.sql` already set for stats.

Removing is refused while the player has an open challenge, rather than
orphaning it.

**The near-miss.** The plan said "purge the 13 inactive players at positions
111–123, all with zero history." By the time the work started there were
**fourteen**. The fourteenth was **Kevin Mock at position 86** — a claimed
account with a match played, a challenge, a $5 treasury entry and three
notifications, deactivated hours earlier. A purge written as "delete the
inactive players" would have deleted a real, paying league member. Re-deriving
the list instead of trusting the one in the plan is the only reason it did not.
Kevin is *deactivated*, which is the correct state for him, and he stays at #86.

**The 13 are not purged by this change.** With a working button, the honest way
to clear them is Carl pressing it — the audit trail then credits the person who
actually decided, each removal is snapshotted, and it proves the button works on
real data. A migration would have had to fake an admin identity to pass the
permission gate.

**Also fixed on the way:** `src/types/database.ts` was missing `inactive_since`
and `inactive_drift_periods`, live on the table since the inactive lifecycle
shipped. Adding `removed_at` surfaced them, and the build then caught the demo
fixture missing all three. That is the schema-drift trap this project keeps
falling into, working as intended for once.

**What the migration review caught, and it mattered.** The first cut only took
a removed player off the *ladder*. `public_players` has no `WHERE` clause at all
and the base policy is `"Anyone can view players" USING (true)`, so a
soft-removed player — the common case for anyone established enough to have
played a match — would have stayed visible to every signed-in player and every
signed-out visitor. That is Carl's original complaint reproduced almost exactly,
by the change meant to fix it. `public_players` now filters `removed_at IS NULL`.
Four smaller findings went with it: the table lock is taken *before* the ladder
position is read (a concurrent ladder swap between the two would have closed the
wrong gap — the reason `serialize_ranking_mutations` exists); restoring a
hard-deleted player no longer forces them active, so somebody deactivated and
then removed comes back deactivated; the snapshot table's `performed_by` and
`restored_by` are `ON DELETE SET NULL`, matching `stats_reset_events`, so
deleting an admin account later cannot be blocked by them; and the open-work
guard now names only statuses `challenges` is really written to, checking
unfinished matches separately instead of inferring them from a status that never
occurs.

**Files:** `supabase/migrations/20260909130000_remove_player_for_real.sql`,
`src/components/admin/PlayersTab.tsx`, `src/types/database.ts`
**Gates:** build ✓ · tests 139/139 ✓ (guest-access included) · lint clean on
changed files · `supabase-migration-reviewer` run, findings above fixed ·
ladder shift and snapshot round-trip both simulated against the live row set
before applying

**Flags:**
- **Deployed after all.** This first read "not deployed — same wall as the last
  change". Chase pushed it out from his own checkout shortly afterward, and it
  is live: verified 2026-09-09 20:14 UTC by asset hash, with
  `topofthefalls.online` now naming `/assets/index-ClChQN22.js` and the
  `AdminPage-Py0dzo7A.js` chunk it loads calling both `admin_remove_player` and
  `admin_restore_player`. Both functions exist live as `SECURITY DEFINER`, so
  the migration landed too. The wall is real but it stops *this session*, not
  Chase — connecting the Git repository is still the fix that removes the manual
  step.
- **A hard-deleted player has no Put back button**, because there is no row left
  to hang it on. `admin_restore_player` handles that case, but reversing it
  today means calling the function directly. A removals list on the Settings tab
  is the follow-up.
- The purge of the 13 is deliberately left to Carl.

---

## 2026-09-09 — Force Cancel cancels, and the Back button comes out from under the clock

**Carl asked:** "Also the force cancel for challenges does not seem to be
working." And, after reading the write-up: "There are certain screens that my
back button doesn't work on my iPhone. I can get it to work by turning the phone
to landscape mode and then the button works."

**Shipped:** Two unrelated bugs in one update, because the second is three lines
and was hitting every iPhone in the league rather than just the admins.

**Force Cancel had never worked once.** Not on any challenge, since the app went
up. `ChallengesTab` cancelled by updating the row straight from the browser.
`challenges` has RLS on and exactly one policy — SELECT, "Anyone can view
challenges" — so there is no UPDATE policy for the row to match. The subtlety is
that `authenticated` still holds the *table-level* UPDATE grant, so Postgres
raises nothing: zero rows qualify, the statement succeeds, PostgREST returns
success with a null error, and `if (error)` never fires. The confirm box closed,
the list refetched unchanged, and Carl got no error to report. Live corroboration:
not one cancel or wash audit event has ever been written, and the single
`cancelled` row in the table came from a player-side path.

Cancelling now goes through `admin_cancel_challenge`, a SECURITY DEFINER RPC in
the shape that already works here (`admin_resolve_wash`): it checks
`is_league_admin()` itself, voids any arranged-but-unplayed match under the
challenge, clears a moot wash alert, writes the activity-feed entry, notifies
both players, and records the audit event. It refuses once a result is final,
with a readable reason, rather than cancelling a challenge whose match has
already moved the ladder.

**A correction to the write-up Carl saw.** That draft said Force Forfeit left the
challenge "stuck in the admin list forever". That was wrong, and reading
`resolve-dispute` settled it: line 118 already stamps the challenge from the
service role, so the challenge does clear. The real defect was smaller — an admin
forfeit was recorded as `resolved`, the same as a settled dispute, because the
client-side line that would have said `forfeited` was the same silent no-op.
`resolve-dispute` now takes a `challenge_outcome` (`resolved` by default,
`forfeited` when an admin forfeits) and the dead client write is gone. The two
other callers — a real dispute, and an admin entering a played result — correctly
keep the default.

**The Back button.** `index.html` sets `viewport-fit=cover` and a translucent
status bar, so an installed app is laid out from the physical top of the screen,
under the clock and the Dynamic Island. Nothing compensated: `env(safe-area-inset-*)`
appeared exactly once in all of `src/`, in `BottomNav` for the bottom. `Layout`
gave `<main>` a top padding of 0, and the affected screens put Back at the top
with 16px of their own, well inside the ~47-59px portrait inset — so iOS took the
tap before the app saw it. Landscape hides the status bar and drops that inset to
zero, which is exactly why rotating the phone "fixed" it. `<main>` now carries the
top inset (and the left/right ones, so landscape clears the notch), and the two
top-pinned banners take the same clearance. Screens with Back at the top —
a player, a challenge, a match, the activity feed, the treasury, the admin
screens — were affected; home and rankings never were, which is what Carl meant
by "certain screens".

**Also removed:** the per-row fallback behind the ladder reorder in
`RankingsTab`. `rankings` is SELECT-only too, so that path could never have
worked — it would have reported a successful save having changed nothing. The
RPC it falls back from is deployed and working, so this was a dormant copy of
the same bug.

**Files:** `supabase/migrations/20260909120000_admin_cancel_challenge.sql`,
`src/components/admin/ChallengesTab.tsx`,
`supabase/functions/resolve-dispute/index.ts`, `src/components/Layout.tsx`
**Branch:** `claude/web-app-issues-carl-1zhzh9` (Chase asked for a branch this
time, so this did not go straight to `main`)
**Gates:** build ✓ · tests 139/139 ✓ · lint clean for changed files (two
pre-existing `react-refresh` errors in `AdminAlertsCard` and
`StatsResetControls` are untouched) · `supabase-migration-reviewer` and
`demo-readiness-checker` both run

**What the migration review caught.** The first cut of the guard only refused a
match that was already `confirmed` or `resolved`. That was too narrow. Once
either player submits a result, `submit-result` books the match fees into the
treasury ledger on every path that reaches `disputed`, and nothing in this
function reverses them — so Force Cancel would have voided a match that had
already been paid for and left the credits stranded. It now also refuses
`submitted`, `confirming` and `disputed`, and sends the admin to the Disputes or
Matches tab, which is where those actually get finished. `admin_resolve_wash`
draws the same line, cancelling only matches still in `scheduled` or
`in_progress`. The review also caught the refusal message pointing at a "reopen
it as a dispute" workflow that does not exist in this app; reworded to say what
is true.

**Flags:**
- The write-up Carl already read overstated the Force Forfeit bug; corrected
  above and in the document sent back to him.
- No cooldown is released on cancel. There is no challenge-issued cooldown to
  release — `post_match` is the only type in live use — so a cancel already
  leaves both players free to challenge again.
- **Shipped in three parts; all three are now live.** This flag first read "the
  frontend is still waiting" — the migration and the edge function were live,
  the code was merged to `main` (`4029203`), and the Vercel deploy was blocked.
  **The frontend has since gone out, verified 2026-09-09 20:06 UTC by following
  the real asset hash**, not by a 200 on an asset path:
  `topofthefalls.online` names `/assets/index-CmsBW3cg.js`; that bundle carries
  all seven `env(safe-area-inset-*)` uses the new `Layout`, `OfflineBanner` and
  `PWAInstallBanner` add (the old code had exactly one, in `BottomNav`); and the
  `AdminPage-ebZRAoDK.js` chunk it loads calls `admin_cancel_challenge` and
  sends `challenge_outcome`. The RPC exists live and is `SECURITY DEFINER`, and
  `resolve-dispute` is deployed at v2. **Carl can see both fixes now.** Who ran
  that deploy is not recorded here — the Vercel MCP token still 403s on the
  `tof2` scope, so it was not this session.
- **`CLAUDE.md` was wrong about who can deploy, and it cost an hour.** It said
  `cdalin1985` was a member of the `tof2` Vercel team. He is not: after a fresh
  `vercel login`, `vercel teams ls` shows only `cdalin-projects`. Corrected in
  the same commit, along with the fact that the Claude GitHub App is not
  installed on `TopFalls` either — so pushes and PR creation both 403, while
  GitHub MCP *reads* keep working and make it look like access is fine.
- **The fix for both is one free thing, not a paid seat.** A Vercel Member seat
  is $20/month on top of Carl's $20 (verified against Vercel's own pricing
  docs), and free Viewer seats cannot deploy. Connecting the Git repository
  costs nothing, needs no seat, and makes every push to `main` deploy itself.
  That is the ask that should go to Carl.
- **Force Cancel has never been executed end to end.** The RPC is verified
  structurally — it exists, is `SECURITY DEFINER`, and grants EXECUTE to
  `authenticated` only — but this session's database access was read-only, so
  nobody has watched it cancel a real challenge. Given the bug being fixed is a
  button that reported success while doing nothing, that first real click is the
  proof and it still owes to be done. **Re-checked 2026-09-09 20:10 UTC and it
  is still owed:** `audit_events` holds no cancel action of any kind, and the
  one `cancelled` challenge in the table is still the 2026-09-06 row from the
  player-side path. Now that the frontend is live, the check is one click in
  Admin → Challenges on a `pending` or `scheduled` challenge — there are 11 and
  9 of those respectively — and the proof is a fresh audit row plus the
  challenge actually leaving the list.

---

## 2026-08-28 — Treasury privacy confirmed with a real non-admin session

**Closes the caveat left on 2026-08-17.** That entry said the activity-feed
treasury policy was "confirmed bound with the right predicate but never
exercised by a real non-admin session", because the only two claimed accounts
on this instance are both admins. It has now been exercised properly.

**How.** A throwaway ordinary player and a throwaway admin were created, and a
**real $250.00 credit** was put in the ledger along with the `activity_feed`
row `manage-treasury` writes beside it — so there was actual money to leak.

**An ordinary signed-in player sees no treasury at all:**

| | what they get |
|---|---|
| `treasury_ledger` | 0 rows |
| `treasury_ledger_effects` | 0 rows |
| `treasury_summary` | one row of **zeros** — `balance_cents: 0`, `entry_count: 0` — while the real balance was 25000 |
| `admin_dashboard_league_overview` | `treasury_balance_cents: 0`, `treasury_last_entry_at: null` |
| the activity feed | the league's other events, and **no** `treasury_entry_*` row |
| `manage-treasury` | HTTP 403 — they cannot write one either |

**A signed-out visitor** gets HTTP 401 on all three treasury relations and all
four `admin_dashboard_*` views, and the guest feed carries no treasury row.

**An admin sees all of it** — ledger, effects, summary and the feed entry. The
lockdown did not lock Carl out.

**Two things this run got wrong before getting right.** The first probe reported
`treasury_summary` as a leak because it counted rows rather than reading them:
an aggregate view over zero RLS-permitted rows still returns one row, of zeros.
Then `admin_dashboard_leaderboard` showed every player at 0 wins, which proved
nothing either way — every player on this instance genuinely has 0 matches. So
it was re-run with two players given **different real records**, 11-3 and 22-7.
Each saw the other as 0-0 and their own record correctly, and a direct query for
the other's row returned nothing. Records are private; the zeros were RLS.

**Cleanup verified:** treasury back to 0 rows, no leftover test players, list
back to 119, admins back to exactly Carl (`super_admin`) and Mike (`admin`).

---

## 2026-08-25 — Admin-entered results tested; a test admin account was left behind and removed

**The K3 admin-entry path had never run.** It was rewritten substantially after
the adversarial review, so the version in production was untested code. It has
now been exercised against the live project, both branches, **15/15**:

- a normal player is refused (403)
- an off-menu game and a race below the league minimum are both refused with a
  readable reason instead of an opaque 500
- **the branch that matters:** two players arranged a challenge in the app, then
  the admin recorded the result — it *finished that challenge* rather than
  writing a rival one. Exactly one challenge exists afterwards, `confirmed`, so
  the hourly expiry cron can no longer forfeit it and overturn the result an
  hour later. That was the critical review finding and it is now proven fixed.
- the ladder swapped, stats and the challenge counter both moved
- recording the identical match twice is refused
- an inactive player cannot be moved up by an admin-entered result
- the 119 real players did not move

**A throwaway admin account survived the test's own cleanup.** The test created
one to call the admin path, and the delete did not take — leaving a live
`profiles` row with `role='admin'` on the production project. It was spotted
because the cleanup printed an admin count of 3 where 2 was expected, and
removed immediately along with the audit rows that were blocking it by foreign
key. Verified after: 0 test accounts, 0 orphan profiles, admins back to exactly
Carl (`super_admin`) and Mike (`admin`), 7 auth accounts, roster 119.

**The lesson is the cleanup, not the test.** Deleting an auth user through the
admin API fails silently when `audit_events.actor_profile_id` still references
the profile. Any future test that grants a role must check the admin count
afterwards, not just that its own rows are gone.

**Also closed in this pass:**
- `.agents/` and `.codex/` had been swept into a commit by `git add -A`. They
  are generated mirrors for other agent runtimes, and `docs/ruflo.md` is
  explicit that `.claude/agents/` and `.claude/skills/` are the only committed
  Claude Code footprint. Untracked and gitignored.
- `engaged_player_ids()` was granted to `authenticated`. Its only caller runs on
  the service role, so the grant handed every signed-in player a
  SECURITY DEFINER function listing who is tied up league-wide. Revoked, then
  verified live that a challenge can still be issued.
- Supabase's linter reports all six guest views as `security_definer_view`
  ERRORs. That is deliberate and is now written into `CLAUDE.md` — switching
  them to `security_invoker` would return nothing to `anon` and silently kill
  guest access and the live scoreboard.

---

## 2026-08-25 — The golden path was walked end to end for the first time

**Not a change — a test.** Claim → challenge → accept → submit → confirm had
never once been run on this instance by anything other than a person, and no
person had run it either. It has now been run against the live project, through
the real edge functions, with real signed-in user tokens.

**How.** Two throwaway accounts and two roster rows were created at #120 and
#121, below all 119 real players. Every step went through the deployed HTTP
endpoints — `claim-player`, `create-challenge`, `respond-to-challenge`,
`submit-result` — not through SQL, so the eligibility rules, the open-player
rule, the cooldowns and the confirmation handshake were all genuinely exercised.

**15/15 checks passed:**

- both roster rows claimed and bound to an account
- the player below challenged the one above; the new open-player rule returned
  `challenger_protected = true`, which is right — nobody else was engaged
- accepting created a match with the challenger as `player1`, the convention the
  ladder maths depends on
- both players submitted the same score; the match went to `confirmed`
- **the winner took the loser's spot and the loser dropped to the winner's** —
  the first time the 2026-08-14 swap has moved anyone
- stats: winner 1W-0L with `challenger_wins` credited and a streak of 1; loser
  0W-1L
- the loser picked up a `post_match` cooldown
- the league feed carried `challenge_issued`, `challenge_accepted`,
  `match_confirmed` and the two `match_fee_recorded` rows
- both players were notified at every stage
- **the 119 real players did not move a single spot**

**Everything was removed afterwards.** Accounts, roster rows, rankings, match,
challenge, stats, cooldowns, notifications, feed rows and audit rows. Verified
after: 0 test rows, roster back to 119, positions 1–119 contiguous with no gaps
or duplicates, top five unchanged, 0 challenges, 0 matches, 0 notifications.

**One thing the test itself turned up.** Submitting a result with a payment
method writes real rows into `treasury_ledger`, so the run put two $5 match-fee
entries into Carl's live ledger. They were removed and the treasury is back to
0 rows and a 0 balance — but it is worth knowing that a match fee is a treasury
write, not just a note on the match.

---

## 2026-08-25 — The rest of the questionnaire, and what a review of it caught

**Carl asked:** the remaining answers from the league questionnaire — K3, H1, H2,
L3, and the open-player rule he described across B5, L4 and L5.

**Shipped, all live:**

1. **An admin can record a match for players who don't use the app.** Carl:
   *"Leave them on the list I will enter there results myself."* New **Record**
   tab in the admin screen. It runs the same server code a normal two-player
   confirmation runs, so the list moves and both records update exactly as if
   the players had entered it themselves.
2. **Carl can message the whole league.** New **Announce** tab. Every player
   with an account gets a notification and it lands in the league feed. Players
   who haven't claimed their name have no account to receive it, and the screen
   says so.
3. **Match-day reminders.** Both players get a notification the morning of a
   scheduled match. Runs 9am Mountain.
4. **Challenge expiry now runs on a clock.** It only ever fired as a side effect
   of somebody *creating* a challenge, so on a quiet week nothing expired and
   the forfeit rule from 2026-08-14 never fired at all. Hourly now.
5. **A new player lands on their own record** after claiming, not the league
   home. Carl, asked what they should see first: *"Their own record."*
6. **The open-player rule.** Carl's B5/L4/L5 answers joined up: several people
   may challenge the same player; you may always challenge somebody already in
   a match; but if an *open* player was sitting in your range and you skipped
   them, you lose your own protection and anyone below may challenge you while
   you wait. **This ships ON.** It is an interpretation of three free-text
   answers, so it has a switch — `UPDATE league_settings SET open_player_rule =
   false;` restores one-challenge-at-a-time with no deploy.

**The ladder swap was tested for the first time.** `cascade_ranking_after_win`
was rewritten on 2026-08-14 and had never once executed. Two throwaway players
were created at #120/#121 inside a transaction that then rolled itself back:
challenger-from-below wins → the two swap and `previous_position` is right on
both; defender wins → nobody moves; the real 119-player ladder byte-identical
before and after. Nothing persisted, no migration ledger row.

**A review of this batch found fourteen defects and all fourteen are fixed.**
Five reviewers were run against the diff; a session limit killed three of them
and every verifier, so the two that finished were triaged by hand rather than
trusted. The one that mattered:

> **Admin-entered results would have been silently overturned an hour later.**
> If two players arranged a match in the app and then played it offline, Carl
> recording the result wrote a *second* challenge and left the original open.
> The new hourly expiry cron would then forfeit that original — moving the
> ladder a second time, crediting a forfeit win to the player who actually
> lost. Fixed: the server now finds the live challenge and finishes *that* one,
> taking its record of who challenged whom over whatever the form said.

Also fixed from that review: the open-player queries swallowed their errors and
failed *open*, so a transient database blip read as "the board is clear" and
handed out protection nobody earned — it fails closed now. Protection never
expired, because only `pending` challenges are ever swept, so an accepted
match nobody played would have frozen everyone below that player forever.
Players on a cooldown were wrongly treated as unavailable, when a cooldown only
stops you *issuing* a challenge and never stops you defending. A washed
challenge left its match row alive for good, marking both players permanently
busy. `engaged_player_ids()` was defined in SQL and then quietly re-implemented
in TypeScript — the exact drift this repo keeps getting bitten by. Plus
duplicate-entry protection, an `is_active` check, validation against the
league's own settings instead of an opaque 500, and the challenge counters the
admin stats page reads.

**Two things worth knowing about the state of the league.** As of this entry
the database holds **zero challenges and zero matches**, and **two claimed
accounts** — Carl and Mike. Whatever has been announced, no player has yet
signed in and used it. So none of the above disturbed anything in flight, and
the golden path still has not been walked by a real player.

**Files:** 4 new migrations, `create-challenge`, `submit-result`,
`AnnouncementsTab`, `RecordMatchTab`, `AdminPage`, `Layout`,
`NotificationsPage`, `database.ts`, 1 new test file
**Gates:** build ✓ · tests 139/139 ✓ (110 before, 29 new)
**Deploy:** 4 migrations applied · `create-challenge` and `submit-result`
redeployed via the Supabase CLI, both smoke-tested · frontend via
`npx vercel --prod --yes --scope tof2`

**Flags:**
- The open-player rule is ON and changes live play. The switch above is the
  revert; it needs no deploy and takes effect on the next challenge.
- A challenge that is accepted and then never played still blocks its
  challenger from issuing another one, forever — nothing sweeps `accepted` or
  `scheduled`. Protection now expires at the 10-day deadline, but the
  challenger stays stuck. Carl can clear it with the wash tool. Worth a proper
  rule at some point; inventing one here would have been guesswork.
- The challenge screen does not yet know who is protected, so a player can tap
  Challenge and get a refusal. The message explains why. Fixing it properly
  needs protection published to the client, which is a wider change.
- `cooldowns.type` in the TypeScript types listed a value nothing writes and
  omitted two the app uses daily. Corrected in passing.

---

## 2026-08-17 — Live scores for the whole league, and a way in for guests

**Carl asked:** *"matches that are using the score board to be displayed live
for everyone logged in"* and *"we also want a way for guests to log in they get
view only access to rankings and the league activity"* — guests see live scores
too.

**Shipped, all live:**

1. **Live scores are visible to everyone.** A match in progress now shows on the
   home screen for the whole league — both names, the running score, the race
   and the venue — refreshing every ten seconds. The `matches` table stays
   private to its two players; widening that policy would have published payment
   methods and result submissions along with the score. Instead the scoreboard
   comes from `public_live_matches`, which carries scores only and drops a match
   the second it stops being played. The card is deliberately not tappable —
   the match screen reads the private row, so it opens for the two players at
   the table and nobody else.
2. **Guests can look without an account.** `topofthefalls.vercel.app` now opens
   on a guest page — top of the list, live scores, recent league activity, the
   rules, and a sign-in button — instead of bouncing straight to the login
   screen. Guests can also open the full list and the full activity feed. Three
   routes, no more: player profiles, matches, challenges, settings, admin and
   treasury all still require signing in. Rows on the list are inert for a guest
   because a player's page shows their record.

**Two things were wrong underneath, both found while building this:**

3. **The treasury was still readable — through the activity feed.** August 14
   locked the ledger and its two views, but `manage-treasury` also writes a
   plain-English row into `activity_feed` for every entry (*"Admin added $250.00
   credit to league treasury · March dues"*), and that feed was `USING (true)`.
   Any signed-in player could have reconstructed the ledger line by line. No
   entries exist yet so nothing was actually disclosed, but the path was open.
   Treasury rows are now admins only. Guests additionally don't see
   `match_fee_recorded`, which names a player and how they paid.
4. **`anon` held INSERT, UPDATE, DELETE and TRUNCATE on 15 tables**, including
   `players` and `rankings` — Supabase's shipped default, with RLS as the only
   thing standing in the way. Checked before changing anything: every one of
   those tables denies writes at the policy layer, and a live probe with the
   public key confirmed it. But one permissive policy added in future would have
   been the whole defence. `anon` now has SELECT on the six guest views and
   nothing else at all, and the default-privileges grant that would re-open the
   next new table is revoked.

**One latent bug fixed on the way.** `ThemeProvider` reads the league theme
before anything knows whether there's a session. Once `anon` lost
`league_settings` it would have fallen back to the default theme for every
guest — invisible today only because the league is set to the same
`emerald-forest` the fallback uses. It reads a one-column view now.

**Verified against the live system, not assumed.** With the real public key:
all six guest views return 200; all 21 base tables and admin views return
`42501`; POST and DELETE against `players`, `rankings`, `activity_feed` and the
views all return `42501` and no probe row was written. The first write probe
came back `400 PGRST204` — a bad column name, not a refusal — and was re-run
with valid columns before being believed.

**Not verified.** The activity-feed policy is confirmed bound with the right
predicate and is the only policy on the table, but it has not been exercised by
a real non-admin session: both claimed accounts on this instance are admins, and
the database connection here is read-only, so neither a test row nor a role
switch was possible.

**Files:** 4 new migrations, `useLiveMatches`, `LiveMatchesCard`,
`GuestHomePage`, `GuestBar`, `useRankings`, `ThemeProvider`, `App`, `Layout`,
`RankingsPage`, `ActivityPage`, `LoginPage`, `HomePage`, `database.ts`,
`keepalive.yml`, 1 new test file
**Gates:** build ✓ · tests 110/110 ✓ (98 before, 12 new)
**Deploy:** 4 migrations applied · frontend via `npx vercel --prod --yes --scope tof2`

**Flags:**
- The keep-alive workflow pinged `rankings` with the public key and fails the
  job on anything but a 200. It points at `public_rankings` now. It is still
  dispatch-only, so this was not live, but it would have broken the day someone
  enabled the schedule.
- Realtime is not used for live scores. RLS applies to subscriptions too, so a
  change to someone else's match is never pushed. Ten-second polling instead.
- Guest pages are readable by anyone with the URL. That is the request, but it
  means the roster of 117 names and the league feed are now deliberately public.
  No emails or phone numbers are involved — `players` holds neither.

---

## 2026-08-14 — Eight rule and privacy changes from Carl's questionnaire

**Carl asked:** his answers to the 47-question league setup questionnaire
(`docs/carl-questionnaire.html`).

**Shipped, all live:**

1. **The treasury is admin-only.** This was his biggest complaint — *"Players can
   see league stats especially the treasury"* — and it was worse than he knew:
   `treasury_ledger` carried a `USING (true)` policy and both reporting views had
   no RLS at all, every one of them readable by `anon`. Anyone with the public
   key, signed in or not, could read the whole ledger. Now gated on
   `is_league_admin()`, `anon` revoked on all three, both views
   `security_invoker`. Verified: all three return `42501` to the public key.
2. **A win swaps two players instead of shifting a block.** Carl: *"Challenger
   takes spot, the loser goes to the challenger's spot."* Everyone between them
   now keeps their position. A defending winner still moves nobody.
3. **An ignored challenge counts as a forfeit.** Expiry previously only set
   `status = 'expired'` — no loss, no ranking move, no stats. It now runs through
   the same reversible path a decline uses.
4. **Saratoga is open to every player** — the Top 20 restriction is gone, server
   and client.
5. **The one-spot-at-a-time band is the Top 10, not the Top 11**, keyed off the
   challenger's active rank. The rule already existed at the wrong width in two
   places; both were corrected, and a now-redundant special case for #12 removed.
6. **Defending clears the post-loss wait.** Carl: *"If you are challenged and
   defend you may challenge up."*
7. **A wash keeps its 24-hour default but an admin can override it** — clear it
   or shorten it, audit-logged.
8. **Mike Birkoski is an admin** (`disturbingiraq@gmail.com`). He had already
   signed in and claimed his roster row. **This moves canon** — `CLAUDE.md`
   previously said Carl was the sole admin. He remains the sole *super_admin*.

**Not built, pending Carl.** The open-player / "not protected" mechanic from B5,
L4 and L5 rests on something he never states: that being in a challenge normally
shields you from incoming challenges. Two questions are with him. Live scoring
and guest access are specified and queued for the next run.

**How it was built.** Claude planned and reviewed; a Codex worker wrote the
implementation, under `.claude/route/runs/20260814-163138-carl-rules-privacy/`.
The first pass failed review on three stale tests — it changed the rules but left
two test files still pinning Top 11 and the Saratoga gate — and was sent back;
`REVIEW-1.md` records the defects. Its own report claimed a green suite from a
sandbox where it had patched `git ls-files`, so the numbers below are from an
independent run.

**Files:** 5 new migrations, `create-challenge`, `submit-result`, `ladder.ts`,
`league.ts`, `TreasuryPage`, `ChallengePage`, `HomePage`, `AdminAlertsCard`,
3 test files, `CLAUDE.md`
**Gates:** build ✓ · tests 98/98 ✓
**Deploy:** 5 migrations applied · `create-challenge` v3→v4 ·
`submit-result` v4→v5, both smoke-tested · frontend via `npx vercel --prod`

**Flags:**
- The ladder swap changes live mechanics, but no match has been played on this
  instance yet, so no ranking has moved under the old rule.
- `expire_stale_challenges` passes a NULL actor to the forfeit function. Checked
  before applying: the apply function accepts null (an expiry has no human
  actor); only the reverse function requires a real admin.

---

## 2026-08-12 — Confirmed: Carl can add players again

**Verified in the database, not just reported.** Carl added two real players
after the schema-cache fix:

- Anthony Herrera → #118 at 17:40:52 UTC
- Lloyd Boggs → #119 at 17:46:21 UTC

Both have rankings, season stats and discipline stats; both unclaimed; no
invite errors. `Lloyd Boggs` is the same name that appeared in his original
error screenshot. Roster is now 119 with 119 rankings.

**Also proven today, incidentally:** Chase logged in with a 6-digit emailed
code. That closes the last open launch item — SMTP delivers *and* the
magic-link template renders `{{ .Token }}` rather than only a link.

**How it was tested.** `Layout.tsx:95` forces any signed-in user without a
claimed roster row to `/claim`, so an admin with no player row cannot reach the
admin screen at all. Rather than claim a real player's name, the edge function
was called directly from the signed-in browser console. A test player was
created at #120, verified, then removed along with its ranking, stats, metrics,
audit and activity-feed rows.

**Temporary admin grant, now reverted.** `chase.dalin@gmail.com` was promoted to
`admin` to attempt a UI test, then returned to `player`. Verified: Carl is again
the sole admin, matching canon.

**Still untested:** adding a player *with* an email attached. Both of Carl's
adds left the email blank, so the invite path has not run in anger even though
SMTP now works.

---

## 2026-08-12 — The Vercel project had no Git repository connected

**Found while chasing why frontend fixes never appeared in production.** The
Vercel project `topofthefalls` (team `Totf`/`tof2`) shows **"Connect Git
Repository"** on its project card — nothing is attached. Five commits pushed to
`TopFalls/Topofthefalls` never triggered a build. The last deploy was 2 days
old, which matches the Aug 10 code being live and nothing since. Pushing to
`main` does not deploy this app.

**Unblocked without Carl:** the Vercel CLI is installed and Chase is already
authenticated as `cdalin1985`, and `.vercel/project.json` pins the correct
project and team, so `npx vercel --prod --yes` publishes straight to production.
Ran it — deployment `dpl_2QBLPpXBuzbhqz4VikfxkkhRVUyG`, READY. Verified live:
new bundle `index-BpQ9PqN0.js`, and `invite_warning` present in the AdminPage
chunk for the first time.

**Until the Git link exists, every frontend change needs that command.** A `git
push` alone ships nothing to players.

**The durable fix needs Carl.** Verified via the GitHub API: Chase has
`push` but not `admin` on the repo and is an outside collaborator, not an org
member. Attaching the repo requires the Vercel GitHub App to be authorised on
the `TopFalls` org, which only an org owner can approve.

---

## 2026-08-12 — The actual add-player bug: a stale PostgREST schema cache

**Carl's error, verbatim (from his screen):** *"Could not create season stats:
Could not find the 'challenges_issued' column of 'player_season_stats' in the
schema cache"* — with the email field left blank, so the invite path never ran.

**Root cause:** PostgREST was serving a stale schema cache. Both
`challenges_issued` and `challenges_received` have existed on
`player_season_stats` since `20260806122000_add_season_challenge_counters.sql`
and are present and correct in `information_schema`. Postgres was fine; the API
layer in front of it rejected the insert before it ever reached the database.
Edge functions are not exempt — service-role `supabase.from(...).insert()` still
goes through PostgREST.

**Fix:** migration `reload_postgrest_schema_cache` — a `COMMENT ON COLUMN` to
fire Supabase's schema-reload event trigger, plus `NOTIFY pgrst, 'reload
schema'`. No data touched.

**Verified:** POSTing a body naming `challenges_issued` now returns `42501
permission denied` (a grants error) instead of `PGRST204` (column unknown) —
proving PostgREST resolves the column. Also swept all 36 columns the add-player
function writes across five tables; none missing, so there is no second landmine
behind this one.

**Correction to the 2026-08-11 entry.** That entry diagnosed the failure as the
invite email. That was wrong. The invite rollback was a real defect and the fix
stands — an invite failure really would have deleted the player — but it was not
what Carl was hitting. The diagnosis was built on `invited_at` being null and no
`player.added` events, which show that nothing succeeded, not why. Chase
challenged it and was right. The error text settled it in seconds.

**Deploy:** migration applied to `dpbgdisezxlttwrxqanu`. No code change, so no
rebuild needed.

**Flags:**
- If "Add Player" ever fails again on a column that demonstrably exists, suspect
  the schema cache before the schema.
- Still untested end to end: one real add by Carl, with an email attached, now
  that both this and SMTP are fixed.

---

## 2026-08-12 — Email sending works for the first time

**Carl asked:** (follow-on from the add-player error) — get invites actually
sending.

**Shipped:** Custom SMTP configured on the Supabase project via a Gmail relay —
`smtp.gmail.com:465`, user and sender `topofthefallsapp@gmail.com`, Google App
Password. Auth email rate limit raised 100 → 150/hour. Chase did the account
creation and credential entry; that is a stop condition and stays with him.

**Proof, not assumption:** `POST /auth/v1/recover` returned **200** and
`auth.users.recovery_sent_at` advanced to 2026-08-12 16:27:16. The first attempt
failed with Gmail `535 5.7.8 Username and Password not accepted` — an App
Password generated against the wrong signed-in Google account. Regenerating it
under `topofthefallsapp@gmail.com` fixed it.

**Also corrected:** a project memory claimed SMTP had been configured via Resend
and verified on 2026-08-02. That was false by today. Mail had never actually
sent on this project — `invited_at` was null for every user. Rewritten to
verified state.

**Files:** none — this was infrastructure, no code changed.
**Deploy:** n/a · **Gates:** n/a (no code change)

**Flags:**
- **The 6-digit code template is still unverified.** The claim screen asks for a
  code, so the magic-link template must render `{{ .Token }}` and not just a
  link. Sending works; whether the *right* email content goes out is untested.
  This is the next thing to check before anyone is invited.
- Wade Thompson (#4) is unclaimed — the old test-account holding is already
  released, contrary to what the stale memory said.

---

## 2026-08-11 — A failed invite email no longer throws away the added player

**Carl asked:** Getting an error when trying to add players to the list. Also
wants to double-check that player stats are only visible to themselves.

**Shipped:** Adding a player and emailing them an invite are now separate. The
player lands on the ladder with their ranking and stats regardless; if the
invite email fails, the admin sees an amber "added, but the invite didn't go
out" note instead of a red error, and can invite again later. Previously any
invite failure ran the rollback and deleted the player that had just been
created successfully — which is why 117 players had been on the list since the
seed and `player.added` had never once been recorded.

**Root cause:** not the schema. Every column, function and policy the code needs
is present live, no triggers can raise, and Carl's `super_admin` role is
correct. The sole failure point was `inviteUserByEmail` — `auth.users` shows
`invited_at` null for all 5 accounts, so no invite has ever been delivered on
this project. Consistent with custom SMTP still being unconfigured.

**Stats visibility — verified, no change needed.** RLS is on for
`player_season_stats`, `player_discipline_stats` and `matches`; each policy is
`is_league_admin() OR owns_player(...)`; `anon` is revoked on all three; and all
three `admin_dashboard_*` views are `security_invoker`, so they inherit those
policies instead of bypassing them. A player sees their own numbers and Carl
sees everyone's.

**Files:** `supabase/functions/add-player/index.ts`,
`src/components/admin/PlayersTab.tsx`
**Commit:** 262ff8e · **Deploy:** edge function `add-player` v1 → v2, verified live
(boots, returns its own 401 and CORS 200). Vercel frontend pushed; publish not
confirmed from here — the Vercel MCP token has no `tof2` scope and the edge was
serving a 12-hour-cached `index.html`. Not blocking: the fix is server-side, and
the old UI already renders the function's `message`, so Carl gets the player and
the explanation either way. Only the amber styling waits on the publish.
**Gates:** build ✓ · tests 97/97 ✓

**Flags:**
- Redeploying also carried a pending fix live: the old v1 still stamped
  `rank1_since` on a new #1, which contradicts TOF having no rank-1 obligation.
- The invite email itself is still not fixed — that needs custom SMTP, which is
  auth config and a stop condition. Carl can add players now; they just won't
  receive email until SMTP is set up.
- The `supabase_migrations` ledger is missing the last two migrations even
  though their objects exist live. Harmless today, but a future `db push` would
  try to replay them.
