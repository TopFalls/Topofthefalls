---
name: tof-bootstrap
description: Safely set up, verify, or repair the Top of the Falls development workspace for TopFalls/Topofthefalls and its pinned Supabase and Vercel projects. Use for TOF onboarding, environment checks, broken local setup, cloud-link verification, or first local run; do not use for another league or for provisioning replacement cloud resources.
---

# TOF Bootstrap

Prepare a usable TOF workspace without crossing project boundaries or changing
production as a side effect. Read the repository-root `AGENTS.md` first; it is
authoritative when this skill and repository instructions differ.

## Fixed scope

Only use these targets:

- Local root: `C:/Users/cdali/Documents/Codex/TOF-Isolated`
- GitHub repository: `TopFalls/Topofthefalls`
- Git remote: `https://github.com/TopFalls/Topofthefalls.git` or its same-owner SSH equivalent
- Supabase project ref: `dpbgdisezxlttwrxqanu`
- Supabase URL: `https://dpbgdisezxlttwrxqanu.supabase.co`
- Vercel project: `topofthefalls` / `prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo`
- Vercel team: `tof2` / `team_TiDDLGgPBC8TlMQKmrNcFNl8`
- Canonical production URL: `https://www.topofthefalls.online`

Never enumerate account-wide repositories, Supabase projects, Vercel teams, or
Vercel projects. Never inspect or use another repository or cloud project as a
template, comparison, source of credentials, or fallback.

## Safe bootstrap sequence

### 1. Prove local identity

From the fixed local root, run:

```powershell
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\Assert-TOFBoundary.ps1
```

Also inspect `git status --short`, the current branch, and `git remote -v`.
Stop if the guard fails, the root differs, any remote points elsewhere, a merge
or rebase is unfinished, or existing edits would be overwritten.

### 2. Verify links without relinking

Confirm these files match the fixed scope:

- `.vercel/project.json`
- `supabase/.temp/project-ref`
- `docs/TOF-BOUNDARY.json`

Missing or incorrect link files are a stop condition. Report the mismatch and
the expected values. Do not run `vercel link`, `supabase link`, create a cloud
project, switch a team, or replace either link unless the user explicitly
authorizes that exact repair after reviewing the target.

### 3. Verify access separately

Treat GitHub, Supabase, and Vercel as three separate access checks.

- GitHub: use `gh` commands with `--repo TopFalls/Topofthefalls` or the exact
  repository API path. Report the authenticated login and actual permission.
- Supabase: every CLI or MCP call must include
  `--project-ref dpbgdisezxlttwrxqanu` or `project_ref=dpbgdisezxlttwrxqanu`.
  Prefer a read-only function-list or project-health request.
- Vercel: verify `.vercel/project.json` first. Direct CLI/API access may be
  unavailable even when the repository's existing GitHub integration can build
  previews and production deployments. Verify that integration through commit
  statuses and require deployment links to contain `tof2/topofthefalls`.

An access failure stops only that provider's operation. Do not broaden the
credential, switch accounts, add a paid seat, or use another project.

### 4. Verify environment keys safely

Inspect `.env.example`, `.env.sample`, or `.env.template` when one exists. Compare
required key names against the local environment without printing values.
For this Vite app, verify at minimum that `VITE_SUPABASE_URL` names the pinned
Supabase URL and that `VITE_SUPABASE_ANON_KEY` is present. Never copy a secret
from another checkout, commit an `.env` file, print secret values, or treat a
compiled production bundle as a source for secret recovery.

If Vercel environment access is authorized and available, inspect key names only
for the pinned team/project. Do not add, remove, or replace environment values
unless the user authorized that concrete change.

### 5. Prepare and verify the local app

Read `package.json` and use only scripts that exist. Install the locked dependency
set with `rtk npm ci` when dependencies are missing or stale. Do not upgrade
packages during bootstrap.

After identity, links, and environment keys pass:

```powershell
rtk npm run test
rtk npm run build
rtk npm run dev
```

Starting the development server is a local verification step. Do not run database
migrations, seeds, resets, Edge Function deployments, Vercel deployments, or
production data tests during bootstrap. Those require their own scoped task,
review, authorization, and verification.

## Repair boundaries

Bootstrap may repair reversible local setup such as installing locked packages or
documenting missing environment key names. It must not provision Neon or another
database, generate an auth secret, initialize a new app, add shadcn components,
change frameworks, relink cloud projects, or replace the existing Supabase setup.

Use `docs/PROJECT-SETUP.md` for current setup details. Treat old commands and
historical notes as evidence to verify, never as permission to mutate production.

## Result

Report:

- verified local root, branch, and remote
- GitHub login and repository permission
- exact Supabase ref and access result
- exact Vercel team/project and direct-access or GitHub-integration result
- required environment key names present or missing, without values
- dependency, test, build, and local-server status
- every skipped or blocked step and why
- direct links only to the allowlisted GitHub repository, Supabase project,
  Vercel project/deployment, and canonical production site

Keep `local`, `preview`, `deployed`, and `verified live` status distinct.
