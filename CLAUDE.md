# TOF project notes

## Authoritative isolation boundary

Read `AGENTS.md` first and run `docs/Assert-TOFBoundary.ps1`.
The only repository is `TopFalls/Topofthefalls`; the only Supabase project is
`dpbgdisezxlttwrxqanu`; the only Vercel project is
`prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo` under team
`team_TiDDLGgPBC8TlMQKmrNcFNl8` (`tof2`).

TOC and TOF are separate, unrelated leagues. Never inspect or use another
league, repository, or cloud project as context or a fallback. Any historical
relationship language in the notes below has no authority to weaken this rule.
Use only `C:/Users/cdali/Documents/Codex/TOF-Isolated` for this project.

`AGENTS.md` governs all work and production approval. Historical commands below
are reference notes, not permission to run them. Stop an operation whose access
is denied. The existing GitHub integration to the pinned Vercel project is a
separately authorized deployment route under AGENTS.md, even when direct Vercel
CLI/API login is unavailable. It does not authorize production changes without
approval or evasion of a GitHub/Vercel deployment rejection.

## League canon

### Challenge-loss rule (released 2026-09-12)

A loss blocks issuing another challenge for exactly 168 hours from the confirmed
result. Receiving and accepting challenges remain available. Winning a defending
match clears the prior post-match wait. Losing a defending match starts a fresh
168 hours from that result, even if the player was already waiting.
Acceptance alone does not clear it. Wash waits remain separate.
Released in PR #9 at production commit `6e0948257bfce4a31a045530f89d2aa5d0da477a`.
The pinned Supabase project runs `create-challenge` v8, `submit-result` v7, and
`resolve-dispute` v3. The production Vercel asset set was verified separately.

Use live `league_settings` and migrations as the source of truth. Current
TOF defaults (verify current behavior before relying on these notes):

- Disciplines: 8 Ball, 9 Ball, 10 Ball, Saratoga (open to every player)
- Venues: Silver Spur, Lido, Black Eagle Country Club
- Roster: 117 players, seeded by `20260609141000_seed_tof_roster.sql`
- Claim flow: email → 6-digit code → claim own unclaimed roster name
- Carl Higgins is super_admin before claiming his player row
  (`20260729120000_league_admin_bootstrap.sql`)
- Mike Birkoski (`disturbingiraq@gmail.com`) holds `admin` access so a second
  league operator can handle admin work
  (`20260814124000_grant_second_admin.sql`)
- Treasury is a ledger/admin function; no real payment processing is live yet.
  It is admin-only in the table, both reporting views, **and the activity feed**
  — `manage-treasury` writes dollar amounts into feed headlines, so
  `treasury_entry_*` rows are gated there too
- **The app is browsable without an account.** Signed-out visitors get `/`,
  `/rankings` and `/activity`, read-only. The `anon` role's entire reach is
  `SELECT` on six views — `public_players`, `public_rankings`,
  `public_player_metrics`, `public_activity_feed`, `public_live_matches`,
  `public_league_settings` — and nothing else in the schema. Those views name
  their columns explicitly so a new column is never published by accident, and
  the default-privilege grant that would re-open the next new table to `anon` is
  revoked. Widening that surface is a deliberate act: add the column to the
  view, and expect `test/guest-access.test.mjs` to argue with you.
  **Supabase's database linter reports all six as `security_definer_view`
  ERRORs. That is expected and must not be "fixed".** Those views run with the
  owner's rights on purpose — that is what lets a signed-out visitor read a
  scores-only slice of `matches`, a table whose RLS is participant-only.
  Switching them to `security_invoker` would return nothing to `anon` and
  silently kill guest access and the live scoreboard. The `WHERE` clause and
  the explicit column list are the boundary, and they are verified from outside
  with the public key
- **Being beaten from below costs exactly one spot. Losing a challenge costs
  nothing.** Carl, 2026-09-11: "A player can never lose more than one spot for a
  loss. But a lesser ranked player challenging a higher ranked player gets the
  spot of that player that was higher, and the higher player always only moves
  down one." And, clarifying: "There's times where a loss doesn't change the
  list at all, and that's when a player lower on the list challenging a higher
  ranked player loses. Nothing changes in that situation."

  So there are exactly two outcomes:

  - **Challenger wins** — a **rotation, not a swap**: the winner takes the spot
    they challenged, the loser moves down one, and everyone the winner passed
    moves down one as well.
  - **Challenger loses** — *nothing moves*. The defender does not climb for
    holding their spot; the challenger does not fall for trying. A losing
    challenger does pick up a cooldown (defend or wait seven days), but that is
    a wait, not a position.

  The only way to move down the list is to be beaten by somebody below you.

  ```
  before   #43 Dan    #44 Jo     #45 Kurt
  Kurt challenges Dan two up and wins
  after    #43 Kurt   #44 Dan    #45 Jo
  ```

  The app swapped the two players until `20260911120000`, which is the same
  thing only when they are adjacent — and spots 11 and below may challenge two
  up, so a two-spot fall was a legal, routine outcome. 14 of 38 ladder-moving
  forfeits on the live project did exactly that. `cascade_ranking_after_win` is
  the single place this happens; played matches, admin-settled disputes and
  forfeits all route through it.

- **Say which way the list runs, every time.** Up the list means towards #1 and
  a **smaller** number; down the list means away from #1 and a **bigger**
  number. "Higher ranked" means a better spot and a smaller number, which is the
  opposite of a higher number — so never write "higher" or "lower" about a
  position without saying which you mean. The rules text in
  `src/config/league.ts` opens with this for the same reason.

- **The league runs continuously — there are no seasons.** No season start, no
  offseason, no rollover; the challenge list is always live. Never use season
  framing in UI copy, admin labels, emails or customer docs — say "the list" or
  "clearing the board". The `player_season_stats` table name is inherited from
  upstream and must not be renamed (edge functions and types depend on it), but
  nothing user-facing should say "season".
- Admins can reset stats per player or league-wide
  (`20260806121000_admin_stats_reset.sql`), in two modes: keep match history, or
  hide pre-reset matches via `stats_reset_at`. Snapshots to `stats_reset_events`
  allow one-click undo. Rankings are never touched by a reset.

The upstream signup triggers hardcoded four personal admin emails. Those are
demoted here and must not come back. Carl remains the sole super_admin on this
instance; Mike's separately granted role is admin, not super_admin.

## Work style

1. Protect customer/demo readiness first.
2. Work on a branch. Production merges, pushes, deployments and database writes require explicit approval under AGENTS.md.
3. Run `npm run build` and `npm run test` before claiming app changes are ready.
4. Do not modify `.env`, secrets, `node_modules`, `dist`, or lockfiles without
   explicit instruction.
5. Keep scratch files out of the repo unless they are intentional project
   documentation under `docs/` or customer setup notes.
6. For terminal snippets, always use this checkout's path first:

```bash
Set-Location -LiteralPath C:\Users\cdali\Documents\Codex\TOF-Isolated
```

## Stack note

This is a **Vite + React SPA** (`npm run build` → `tsc -b && vite build`, output
`dist/`), not a Next.js app. Vercel framework preset: Vite.

## How this deploys — three separate surfaces

**Correction, 2026-09-10: the Git repository is connected now, so a push to
`main` does ship the frontend.** This section used to open "`git push` on its
own ships **nothing**", and that is no longer true of the frontend. Verified
directly: opening
[PR #1](https://github.com/TopFalls/Topofthefalls/pull/1) made `vercel[bot]`
comment on it and build a preview for project `topofthefalls` under team
`tof2` (`prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo`, `team_TiDDLGgPBC8TlMQKmrNcFNl8`),
and pushing a second commit built it again. Both reached Ready. Production is
the same connection with `main` as the production branch, and it matches what
happened on 2026-09-09: `f316175` landed on `main` at 20:00 UTC and the live
bundle had rolled to a new hash by 20:14, with no session running a deploy.

**A PR preview URL is not something to send Carl.** The connection builds one
per branch (`topofthefalls-git-<branch>-tof2.vercel.app`), but it sits behind
Vercel's deployment protection — fetched signed-out on 2026-09-10 it returns
Vercel's own "Login – Vercel" page, not the app. Only someone signed in to the
`tof2` team sees it. For Carl, merge to `main` and give him
`topofthefalls.online`.

Edge functions and migrations still do **not** go through Git. They are
published on their own:

```bash
npx supabase functions deploy <name> --project-ref dpbgdisezxlttwrxqanu
```

Migrations are applied straight to the project — the Supabase MCP
`apply_migration`, or the dashboard SQL editor.

`--project-ref` is not optional. Without it the Supabase CLI can reach two
sibling leagues' projects that are also on this account.

The Vercel CLI route (`npx vercel --prod --yes --scope tof2`) is still written
down because it is the fallback if the Git connection is ever removed, but
nobody here can currently run it: `cdalin1985` is not a member of `tof2`, and
the Vercel MCP token still returns 403 on that scope — re-checked 2026-09-10.
Push to `main` instead.

### Who can connect the Git repository — done

**Carl connected it.** The steps and the reasoning below are kept as the record
of why it was the right ask, not as an outstanding one. What is still live in
this section is the boundary rule and the fact that `cdalin1985` cannot deploy
by CLI.

`TopFalls` is a **personal GitHub account, not an organisation** — verified
2026-09-02 (`owner_type: User`; `/orgs/TopFalls` 404s). Earlier notes in this
repo called it an org and said only "the org owner" could act; that was wrong,
and it matters, because a personal account has no approval flow to wait on.

**Carl controls the `TopFalls` account** — confirmed 2026-09-02. Chase had him
create it so he could run the league himself, and Carl added Chase as a
collaborator. `cdalin1985` has `push` but not `admin`, so it cannot install the
Vercel GitHub App; Carl can, authorising his own account, in about a minute:

1. https://vercel.com/tof2/topofthefalls/settings/git → **Connect Git Repository**
2. Authorise the **Vercel** GitHub App for the `TopFalls` account
3. Grant it the `Topofthefalls` repository, production branch `main`

**Correction, 2026-09-09: `cdalin1985` is NOT a member of the `tof2` team.**
This section previously said he was, and that the GitHub half was the only
blocker. Both halves are blocked, and the wrong half was chased for an hour
before anyone checked. After a *fresh* `vercel login`, `vercel teams ls` returns
exactly one team — `cdalin-projects` / `cdalin1985`. Carl's `Totf` / `tof2`
(`team_TiDDLGgPBC8TlMQKmrNcFNl8`) is not listed, `vercel --scope tof2` fails
"The specified scope does not exist", and the login itself warns *"Your
previously selected team is no longer accessible"*. Membership lapsed at some
point; when is not recorded.

**Do not "fix" this by deploying to `cdalin-projects`.** That is the upstream
team, and pushing Carl's build there is the instance-boundary condition.

**The seat is not the answer; the Git connection is.** Verified against
`vercel.com/docs/plans/pro-plan` (updated 2026-09-02): Pro is a $20/month
platform fee including **one** deploying seat, and each additional Owner or
Member seat is **$20/month**. Viewer seats are free and unlimited but "cannot
configure or deploy projects", so a free seat would not help. Adding Chase as a
Member would take Carl from $20 to $40/month. Connecting the Git repository
instead costs nothing and needs no seat at all: the deploy is triggered by the
webhook and attributed to the team, so whoever pushes needs no Vercel account.
Carl owns the team and can do it himself.

**GitHub write access — fixed 2026-09-10.** This section previously said the
Claude GitHub App was not installed on `TopFalls`, and that work therefore had
to leave the session as a `git format-patch` file for Chase to `git am`
locally. That was true on 2026-09-09: `git push` over HTTPS returned 403
"Claude doesn't have GitHub access to TopFalls/Topofthefalls" and GitHub MCP
*writes* returned 403 "Resource not accessible by integration", while MCP
**reads** kept working — which is misleading, because being able to list
branches says nothing about being able to push.

It works now. On 2026-09-10 the same session pushed a branch and opened
[PR #1](https://github.com/TopFalls/Topofthefalls/pull/1) through GitHub MCP,
both first try. What changed is not recorded here; the observable fact is that
pushes and PR creation succeed. **Do not fall back to the patch round trip
without trying the push first.** If a 403 ever comes back, the install lives at
https://github.com/apps/claude/installations/select_target and is Carl's to do.

Note that a remote-tracking ref for a branch can exist locally without the
branch existing on GitHub — `git ls-remote --heads origin` is the check that
does not lie.

**After a frontend deploy, verify by following the real asset hash.** Fetch the
live `index.html`, read the `/assets/index-*.js` it names, fetch that and grep
for a string unique to the new code. A 200 on an asset path proves nothing —
the SPA rewrite returns `index.html` for any path — and the apex domain
308-redirects to `www.`, so `curl` needs `-L`.

### Never run `supabase db push` against this project

Migrations have always been applied directly, so
`supabase_migrations.schema_migrations` records the *time each was applied*,
while the local filenames carry the time each was *written*. The two sets do
not overlap at all: **none** of the 61 local migration versions appears in the
ledger. `db push` would therefore treat every one as unapplied and replay the
whole history against a database that already has it.

That is not a harmless no-op. 26 of those files contain statements that execute
at migration time and are not re-runnable — 12 with a top-level `CREATE POLICY`
(Postgres has no `IF NOT EXISTS` for policies, so it errors outright) and 14
with unguarded `INSERT`s into `audit_events` and `league_settings` that would
duplicate rows.

Two migrations — `align_rules_with_league_document` and
`inactive_lifecycle_and_wash` — have no ledger entry under any name. They *were*
applied; their functions, tables and columns were all confirmed present live.
The ledger simply never recorded them. Do not "fix" that by pushing.

If the ledger is ever worth reconciling, the tool is
`supabase migration repair --status applied <version>`, which records a
migration as applied without executing anything. That is a deliberate,
separate decision — not a step in a deploy.

## The editing room

Any change, edit, fix or addition Carl asks for goes through
`.claude/skills/tof-edit/SKILL.md` (`/tof-edit`) — the dedicated room for this
app and nothing else. It takes Carl's request in his own words and carries it to
deployed: intake → change → build/test gates → commit to `main` → Vercel → a
plain-English report Chase can forward.

**Carl asking for it is the authorization.** Product decisions are not routed
back to Chase. Only four things stop the room: crossing the instance boundary,
irreversibly destroying live data, touching secrets/auth config, or moving real
money. Everything else ships, and every shipped change is logged in
`docs/tof-change-log.md`.

## Tools on hand

See `docs/ruflo.md` for the **ruflo** agent meta-harness — what it is, the
curated setup that keeps it out of this product repo, and the portable
`.claude/agents/` set that travels to other league clones.

## Historical upstream notes

Older docs under `docs/` may reference the original TOC.Monster app or the
original TOF deployment, because this codebase was split from TOC.Monster and
then cloned from TOF. Treat those as upstream history, not deployment
instructions for this instance, unless explicitly updated here.
