# Top of the Falls 🎱

**A Great Falls, Montana pool challenge list app for the Top of the Falls league.**

TOF is a live challenge league app where players compete for position on a single ranked list. Players challenge above them, matches update the ladder, and admins can manage the day-to-day operation without running the list from a spreadsheet.

This repo is **Carl Higgins' own instance** of the Top of the Falls app — the same league on infrastructure Carl owns. It is separate from the upstream TOF deployment and from TOC 1 / `toc1`, and must not mutate either.

```text
This instance:  https://github.com/TopFalls/Topofthefalls
  Vercel:       not yet provisioned
  Supabase:     not yet provisioned
  Operator:     Carl Higgins / cj_higgins@msn.com

Upstream TOF:   https://github.com/cdalin1985/TOF
  Vercel:       tof-app / https://tof-app-theta.vercel.app
  Supabase:     TOF / sqcqmovskpoyutfyslym

TOC 1 repo:     https://github.com/cdalin1985/claude-agent0toc
TOC 1 live:     https://toc.monster

Customer:       Top of the Falls / Great Falls, MT
```

See `PROJECT_BOUNDARIES.md` — the upstream app is live and shares this league's
roster, so pointing this instance at its database is the failure mode to avoid.

---

## Current Status

- Built from the hardened TOC 1 production baseline, cloned from the upstream TOF app.
- Customized for Top of the Falls / Great Falls branding and rules.
- Includes an emerald/gold `emerald-forest` theme.
- **Supabase project: not yet provisioned.** Migrations, including the 117-player roster seed, are ready to run against it.
- **Vercel project: not yet provisioned.** Will deploy from the `main` branch once Git-linked.
- Carl Higgins is seeded as the sole `super_admin` (`20260729120000_league_admin_bootstrap.sql`).
- Includes a localhost-only review mode for non-production review/demo screens.

Safe local review URLs after starting preview:

```text
http://127.0.0.1:4173/login?demo=totf
http://127.0.0.1:4173/rankings?demo=totf
```

The `?demo=totf` mode is guarded to `localhost` / `127.0.0.1` and is intended only for local review. It does not seed or mutate Supabase.

---

## Top of the Falls Rules Snapshot

- Region: **Great Falls, MT**
- Drop/envelope locations: **Silver Spur**, **Lido**, **Black Eagle Country Club**
- Match fee: **$5 per player**
- Challenge response window: **48 hours**
- Accepted match play window: **10 days**
- Weekly challenge limit: **2**
- Minimum race: **6**
- Disciplines: **8 Ball**, **9 Ball**, **10 Ball**, **Saratoga**
- Saratoga is intended for Top 20 matches only.

Challenge movement is customized for TOF:

- Top 11 may challenge 1 spot up.
- Only #11 and #12 may challenge #10.
- Spots 12+ may challenge up to 2 spots.
- There is **no** rank #1 obligation. The TOC 1 baseline forced #1 to play two
  top-5 opponents within 30 days or be demoted; `20260615120000_tof_remove_rank1_obligation.sql`
  neutralizes it because the Top of the Falls ruleset has no such rule.

---

## Local Development

```bash
npm install
npm run build
npm run test
npm run preview -- --port 4173 --host 127.0.0.1
```

Recommended verification before any customer review:

```bash
npm run build
npx eslint src --max-warnings 0 --rule '{"react-hooks/set-state-in-effect":"off","react-refresh/only-export-components":"off"}'
node --test test/*.test.mjs
```

---

## Supabase Separation Rule

This instance must use its own Supabase project. Do **not** seed or edit the
upstream TOF project (`sqcqmovskpoyutfyslym`) or TOC 1 / `toc1` while working here.

This database should start clean — feature parity with the upstream schema and
functions, plus this league's roster, but **none** of the upstream instance's
existing challenges, matches, treasury entries, or league history. The roster is
seeded from a migration in this repo, never exported from a live project.

There is deliberately no fallback Supabase project in `src/lib/supabase.ts`. If
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset the app throws at
startup, rather than silently connecting to another league's database.

---

## Tech Stack

- React + TypeScript + Vite
- Tailwind CSS
- Framer Motion
- Supabase Postgres/Auth/Realtime/Edge Functions
- TanStack Query + Zustand

All challenge/result/ranking mutations should go through Supabase Edge Functions. The client should not directly mutate ranked tables.
