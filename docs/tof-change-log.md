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
