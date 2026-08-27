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
