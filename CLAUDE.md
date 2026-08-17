# CLAUDE.md — Project Memory (Carl's Top of the Falls instance)

## Identity

This repository is **Carl Higgins' own instance of Top of the Falls (TOF)**.

Same league, same rules, same roster — **different infrastructure**. It is a
separate deployment owned and operated by Carl, not a second copy that may reach
into the original app's resources.

- Customer/league: Top of the Falls, Great Falls, MT
- League operator / super_admin: Carl Higgins (`cj_higgins@msn.com`)
- Local checkout: `C:/Users/cdali/Downloads/Topofthefalls`
- GitHub repo: `TopFalls/Topofthefalls`
- Production branch: `main`
- Vercel project: `topofthefalls` (`prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo`), team `Totf` / `tof2` (`team_TiDDLGgPBC8TlMQKmrNcFNl8`)
- Supabase project/ref: `dpbgdisezxlttwrxqanu`, org `Top of the Falls` (`qlsdgysivqxpigttcaon`)
- Supabase URL: `https://dpbgdisezxlttwrxqanu.supabase.co`
- Public URL: `https://topofthefalls.online` (custom domain, live and serving;
  `www.` too). `https://topofthefalls.vercel.app` is the Vercel alias and also
  works. Give people the `.online` address.

Never substitute a value from one of the apps listed below.

## Boundary rule

There are three sibling apps built from this codebase. This repo is the first
one. Never point it at the other two.

| App | GitHub | Vercel | Supabase | URL |
|---|---|---|---|---|
| **This instance (Carl's)** | `TopFalls/Topofthefalls` | `topofthefalls` (team `tof2`) | `dpbgdisezxlttwrxqanu` | `topofthefalls.online` |
| Original TOF app (Chase's) | `cdalin1985/TOF` | `tof-app` | `sqcqmovskpoyutfyslym` | `tof-app-theta.vercel.app` |
| TOC.Monster / Top of the Capital | `cdalin1985/claude-agent0toc` | `toc-app` | `toc1` | `toc.monster` |

- Never point this code at the original TOF app's Supabase project, its Vercel
  project, or its database. The two instances share a schema and a roster but
  must never share a database — writes made here must not reach the app Carl's
  players are already using.
- Never point this code at TOC.Monster's Supabase or Vercel project.
- The original TOF app is *upstream*, not a fallback. Treat its project ref
  (`sqcqmovskpoyutfyslym`) as a forbidden literal in this repo.

Two hazards were already removed from this repo and must not be reintroduced:

1. `src/lib/supabase.ts` shipped a hardcoded fallback to the upstream project's
   URL and anon key, so a deploy with unset env vars silently used the wrong
   database. It now throws instead. **Never re-add a literal Supabase URL or
   anon key to that file.**
2. `.github/workflows/keepalive.yml` ran a cron ping against the upstream
   project. It is dispatch-only and reads repository variables now.

If identity is unclear, verify before editing:

```bash
git remote -v
cat .vercel/project.json
cat supabase/.temp/project-ref 2>/dev/null || true
```

## League canon

Use live `league_settings` and migrations as the source of truth. Current
defaults (identical to the upstream app — this is the same league):

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
  view, and expect `test/guest-access.test.mjs` to argue with you
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
2. Use `main` for production deploys unless Chase explicitly asks for a branch/PR.
3. Run `npm run build` and `npm run test` before claiming app changes are ready.
4. Do not modify `.env`, secrets, `node_modules`, `dist`, or lockfiles without
   explicit instruction.
5. Keep scratch files out of the repo unless they are intentional project
   documentation under `docs/` or customer setup notes.
6. For terminal snippets, always use this checkout's path first:

```bash
cd /c/Users/cdali/Downloads/Topofthefalls
```

## Stack note

This is a **Vite + React SPA** (`npm run build` → `tsc -b && vite build`, output
`dist/`), not a Next.js app. Vercel framework preset: Vite.

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
