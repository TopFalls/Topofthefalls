# Top of the Falls (Carl's instance) — Setup Guide

Provisioning runbook for **Carl Higgins' own deployment** of Top of the Falls.
Same league as the upstream app, separate infrastructure.

Read `PROJECT_BOUNDARIES.md` before running anything here. The upstream app is
live; nothing in this guide may target it.

## Connected resources

- **Customer/league:** Top of the Falls / Great Falls, MT
- **League operator:** Carl Higgins (`cj_higgins@msn.com`) — sole `super_admin`
- **Local checkout:** `C:/Users/cdali/Downloads/Topofthefalls`
- **GitHub repo:** `TopFalls/Topofthefalls`
- **GitHub production branch:** `main`
- **Vercel project:** `topofthefalls` (`prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo`)
- **Vercel team/org:** `Totf` / `tof2` (`team_TiDDLGgPBC8TlMQKmrNcFNl8`)
- **Production URL:** `https://topofthefalls.vercel.app` (no custom domain)
- **Supabase project name:** `cj_higgins@msn.com` (org `Top of the Falls`)
- **Supabase project ref:** `dpbgdisezxlttwrxqanu`
- **Supabase URL:** `https://dpbgdisezxlttwrxqanu.supabase.co`

Do not substitute values from the upstream TOF app or from TOC.Monster — see
`PROJECT_BOUNDARIES.md` for both.

Deployment note: the Vercel project is **not yet Git-linked** — the Vercel
GitHub App is not installed on the `TopFalls` org, so pushes to `main` do not
auto-deploy. Deploy with `npx vercel deploy --prod` from this checkout until
Carl installs the app (Vercel dashboard → Project → Settings → Git → Connect),
after which `npx vercel git connect` completes the link.

## Stack

Vite + React SPA. Not Next.js.

- Install command: `npm install`
- Build command: `npm run build` (`tsc -b && vite build`)
- Output directory: `dist`
- Vercel framework preset: **Vite**

## Local development

```bash
cd /c/Users/cdali/Downloads/Topofthefalls
npm install
npm run build
npm run test
npm run preview -- --port 4173 --host 127.0.0.1
```

`npm run dev` and `npm run preview` require `.env` with this instance's own
Supabase values (see below). There is deliberately no fallback project — the app
throws at startup if they are missing, rather than silently using another
league's database.

```
VITE_SUPABASE_URL=https://<this-instance-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<this-instance-anon-key>
```

## Provisioning checklist

### 1. Supabase project

Create the project (or gain access to Carl's existing one), then:

```bash
cd /c/Users/cdali/Downloads/Topofthefalls
npx supabase login
npx supabase link --project-ref <this-instance-ref>
npx supabase db push --linked
```

`supabase/config.toml` still carries the upstream `project_id` and `site_url`.
Update both before running `npx supabase config push`:

- `project_id` → this instance's ref
- `[auth] site_url` and `additional_redirect_urls` → this instance's Vercel URL

Migrations live in `supabase/migrations/` as timestamp-named files and run in
timestamp order. They include the 117-player roster seed
(`20260609141000_seed_tof_roster.sql`) and the admin bootstrap
(`20260729120000_league_admin_bootstrap.sql`, which makes `cj_higgins@msn.com`
the sole `super_admin`).

Release hardening guardrail to keep visible in this checklist:
`20260519110000_release_hardening_guardrails.sql`.

### 2. Edge functions

Eleven functions must be deployed for the app to work — the claim flow, all
challenge and match handling, treasury, and push all live here.

```bash
cd /c/Users/cdali/Downloads/Topofthefalls
for fn in claim-player create-challenge respond-to-challenge update-match-score \
          submit-result resolve-dispute manage-treasury rank1-compliance \
          add-player send-push set-player-active; do
  npx supabase functions deploy "$fn" --project-ref <this-instance-ref>
done
```

### 3. Vercel project

Link the project to `TopFalls/Topofthefalls`, branch `main`, framework Vite.

Set these environment variables in **Production, Preview and Development**
scopes — all three, or preview deploys will throw at startup:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<this-instance-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | this instance's anon public key |

Optional, only if the corresponding feature is used:

| Variable | Purpose |
|---|---|
| `VITE_VAPID_PUBLIC_KEY` | web push (currently wired but disabled) |
| `VITE_PAYPAL_URL` / `VITE_CASH_APP_URL` / `VITE_VENMO_URL` | treasury payment links |

Verify no variable contains `sqcqmovskpoyutfyslym`. A push to `main` then
triggers a production deployment.

### 4. Keep-alive workflow

`.github/workflows/keepalive.yml` is dispatch-only until configured. Free-tier
Supabase projects pause after ~7 days idle. To enable, set repository variables
`SUPABASE_URL` and `SUPABASE_ANON_KEY` to this instance's values and restore the
`schedule:` trigger documented in that file.

## Auth and admin notes

- Member login is email → 6-digit code.
- Claiming a player row is separate from admin role.
- Carl Higgins is `super_admin` before claiming the `Carl Higgins` roster row.
- Members claim their own unclaimed roster name after first login.
- The upstream signup triggers granted admin to four personal emails unrelated to
  this league. `20260729120000_league_admin_bootstrap.sql` removes them. If a
  developer break-glass admin is wanted here, add it deliberately.

## League settings snapshot

Same as upstream — this is the same league:

- Venues: `Silver Spur`, `Lido`, `Black Eagle Country Club`
- Disciplines: `8 Ball`, `9 Ball`, `10 Ball`, `Saratoga` (Top 20 only)
- Minimum race: `6`
- No maximum race configured (`max_race = null`)
- Challenge range: `2`
- First challenge range: `2`
- Cooldown: `24` hours
- Challenge expiry: `2` days
- Theme: `emerald-forest`
