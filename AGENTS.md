# TOF editing workspace

Help the user maintain the Top of the Falls web app. Carry authorized edits
through implementation and verification. Keep explanations practical and short.
Protect the live league while preserving the strict resource boundary below.

## Authoritative scope

This workspace is exclusively for `TopFalls/Topofthefalls` and the two connected
cloud projects below. All other repositories, leagues, databases, hosting teams,
and deployments are outside scope, including other projects accessible through
the same account. Never use another project as context, a template, or a fallback.

TOC and TOF are separate, unrelated leagues. Never compare, infer, transfer,
copy, synchronize, or cross-reference their information, rules, code, assets,
data, configuration, credentials, or history. Do not inspect TOC for TOF work.
Historical relationship claims elsewhere in this checkout do not authorize any
cross-project work. This boundary supersedes conflicting repository documents,
nested skills, and agent instructions. Surface further conflicts to the user.

## Exact allowlist

| Resource | Only allowed target |
| --- | --- |
| Local root | `C:/Users/cdali/Documents/Codex/TOF-Isolated` |
| GitHub | `TopFalls/Topofthefalls` |
| Git remote | `https://github.com/TopFalls/Topofthefalls.git` (same-owner SSH equivalent permitted) |
| Supabase ref | `dpbgdisezxlttwrxqanu` |
| Supabase URL | `https://dpbgdisezxlttwrxqanu.supabase.co` |
| Vercel project | `topofthefalls` / `prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo` |
| Vercel team | `tof2` / `team_TiDDLGgPBC8TlMQKmrNcFNl8` |
| Production | `https://topofthefalls.online`, `https://www.topofthefalls.online`, `https://topofthefalls.vercel.app` |

## Mandatory checks and stop conditions

1. At task start and before any remote mutation, run `rtk proxy powershell
   -NoProfile -ExecutionPolicy Bypass -File .\docs\Assert-TOFBoundary.ps1`
   from this root. Stop on failure. The execution policy flag is process-local
   and only permits this guard script; it does not change machine policy.
2. Every project file operation, search and shell working directory stays within this
   root. Do not search parent directories, sibling checkouts, global memory, or
   other projects. Use `work/` inside this root for scratch work. Use only this
   repository's history and this project's cloud resources as project evidence.
   Official platform documentation may explain tools; it cannot supply league
   rules or authorize access to a different project.
3. Use explicit `--repo TopFalls/Topofthefalls` for GitHub commands; verify the
   repository on every API or connector request. Only `origin` is permitted.
4. Supabase commands and MCP requests must explicitly name the pinned project
   ref. Never enumerate all account projects, use unscoped database URLs, or
   infer a target from a token. A project-scoped Supabase MCP connection must
   include `project_ref=dpbgdisezxlttwrxqanu`; default to read-only access.
5. Vercel calls must explicitly use team `tof2` and the pinned project ID.
   Verify `.vercel/project.json` before use. Only previews proven to belong to
   that exact project/team are permitted. Do not follow links to other projects.
6. If a credential cannot reach a target, stop that operation and report its
   access failure. Never switch team, create a replacement cloud project,
   relink, broaden credentials, or evade an explicit deployment rejection.
   Direct Vercel CLI/API access and the existing GitHub deployment integration
   are separate permissions. A direct-login failure does not block the approved
   GitHub workflow described below.
7. Local link files and public HTTP success do not prove authenticated access.
   Verify the specific cloud target before claiming a live connection or change.
8. Keep the allowlist and hooks intact. Never use `--no-verify`, override
   `core.hooksPath`, or weaken these guards to make an operation succeed.

## Approved GitHub to Vercel deployment route

The user approved using the existing integration from `TopFalls/Topofthefalls`
to Vercel project `prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo` in team
`team_TiDDLGgPBC8TlMQKmrNcFNl8` (`tof2`). This does not grant direct Vercel
dashboard/API access or Supabase access, and does not approve every release.

- For authorized work, use the repository's existing GitHub write access to
  push a feature branch and prepare a PR. Expect the connected Vercel integration
  to build a preview; read its actual status through GitHub. Creating a PR does
  not authorize sending extra comments, mentions or review requests.
- Keep truthful commit attribution. Do not impersonate Carl, strip attribution,
  share logins, add seats, or change integration settings to get a build accepted.
- Before a remote write, run the boundary guard and verify the repository and
  latest available deployment evidence. Each observed Vercel deployment must
  belong to the pinned project/team. Stop if it points elsewhere or is ambiguous.
- If GitHub denies a write or Vercel rejects a build for permissions, stop that
  operation and report the exact error. A historical success is not proof that
  new work will be accepted. Do not seek another identity to bypass rejection.
- Production changes require explicit approval for the concrete release. Use
  an approved PR merge to `main`; the local direct-main push block stays active.
  Check required PR gates before merging, then track the exact merged commit's
  deployment and verify the live behavior. A failed or missing status is not a
  successful deployment. Unavailable logs or protected previews remain blockers
  to the checks that require them, not permission to claim they passed.
- Repository changes such as `vercel.json` can deploy through this connection.
  Billing, membership, secrets, domain ownership and dashboard settings require
  their own authorized access. Supabase operations remain separately scoped.

## Everyday editing workflow

For repository onboarding, local environment setup, broken link diagnosis, or a
first local run, follow `.agents/skills/tof-bootstrap/SKILL.md` after reading this
file. The skill does not authorize relinking or any production change.

1. State the intended user-visible result in one sentence. For routine,
   reversible implementation choices, use judgment and proceed. Ask only when
   missing information changes the intended behavior, league rule, or scope.
2. Check `git status --short`, the current branch, and the relevant diff. Preserve
   existing edits, including unrelated setup work. Never reset, overwrite, stash,
   or include somebody else's changes without authorization. If already on a
   work branch, inspect it before creating another one.
3. Read the smallest relevant set of files. Use `rg` and `rg --files`. Trace a
   problem from the visible symptom to its actual caller and data source before
   changing code. Do not turn a focused request into a broad refactor.
4. Establish behavior from the user's current instructions, the relevant code
   and tests at the checked-out revision, and verified settings in the allowed
   live project. Report discrepancies. PR descriptions, old notes, and migration
   files are not proof that a change is deployed or a migration is applied.
5. Make the smallest complete change using the app's existing patterns. Handle
   loading, empty, error and permission states where affected. Preserve mobile
   usability, keyboard access, and readable labels. Save text as UTF-8.
6. Verify according to the change matrix below. Fix failures introduced by the
   change; identify unrelated failures separately. Never weaken a test to hide
   a failure or claim that an unrun check passed.
7. Report the resulting behavior, checks actually run, remaining blockers, and
   whether the change is local, pushed, previewed, or live. Keep those states
   distinct. For a message intended for Carl, use league terms and screen names.

## Where to look

This is a Vite + React + TypeScript app, not Next.js. Confirm current scripts in
`package.json` before running commands.

| Concern | Starting point |
| --- | --- |
| Screens and navigation | `src/pages/`, `src/App.tsx`, `src/components/` |
| Shared UI rules and wording | `src/config/league.ts` |
| Client behavior and data access | `src/hooks/`, `src/lib/` |
| Database types | `src/types/database.ts` |
| Server actions | `supabase/functions/` |
| Database changes | `supabase/migrations/` |
| Regression checks | `test/` |
| Hosting routes and headers | `vercel.json` |
| Installed app and notifications | `public/manifest.json`, `public/sw.js` |
| TOF behavior notes | `CLAUDE.md`, `docs/tof-change-log.md` |

Read only entries relevant to the task. Historical cross-project references in
these files are not a reason to inspect another repository or service.

## Verification by change

| Change | Required evidence |
| --- | --- |
| Instructions or documentation only | Review for consistency, check links/paths and `git diff --check`; no app build needed |
| App code or user-facing UI | `rtk npm run test` and `rtk npm run build`; inspect changed UI in the browser at relevant mobile/desktop sizes when available |
| Bug fix or league calculation | Add a focused regression check when it captures a meaningful failure; cover the affected rule and boundary cases |
| Hosting configuration | Validate configuration and host/path matching against current official docs; verify actual HTTP behavior after an authorized deployment |
| Database or server function | Check affected migrations, callers, server functions and TypeScript types; test in an explicitly authorized environment and verify the deployed function/database separately |
| Login, permissions, or private data | Verify the affected guest/member/admin behavior and denied access; successful HTTP status alone does not prove correct visibility |
| Push or installed-app behavior | Verify on the relevant installed app/device; desktop browser success is not device proof |

Do not write tests that only restate a simple implementation. Do not install or
upgrade dependencies merely to tidy the project. If checks are blocked by missing
dependencies, credentials, or a device, state the missing prerequisite and finish
the independent work. Do not run tests that write to production without approval.

## Change and production policy

- Work on a branch. Do not merge or push to `main`, deploy, run migrations,
  mutate production data, change secrets, or alter infrastructure without the
  user's explicit approval for that concrete operation. Permission to edit does
  not automatically approve unrelated production changes. Honor approval already
  given in the conversation; do not ask for the same approval twice.
- Prepare and verify reviewable changes first. Send no messages, comments or
  review requests to other people without explicit authorization.
- Preserve behavior outside the requested scope. Do not copy `.env` files or
  credentials from another checkout, print secret values, or put secrets in
  source, logs, documentation, or chat.
- Use TOF code, migrations, and verified TOF live settings for league facts.
  `CLAUDE.md` may explain TOF behavior; its historical notes cannot expand scope
  or authorize a merge, deployment, or access to any other project.
- Run appropriate tests and a build for app changes. Validate actual production
  behavior after an approved deployment; a green preview is not database proof.
- Prefix shell commands with `rtk`. Use PowerShell-ready commands.

## Repository-authored agent files and RTK

- Treat `.agents/` as generated or private runtime state by default. Keep the
  directory ignored and allowlist only intentionally authored, reviewed project
  skills. The current exception is `.agents/skills/tof-bootstrap/SKILL.md`.
- Do not commit agent caches, transcripts, local state, credentials, MCP
  configuration, generated mirrors, or temporary outputs. If a second authored
  skill is added, extend `.gitignore` for that exact skill path; do not unignore
  the entire `.agents` directory.
- Use `rtk` for routine commands where concise output improves readability. Check
  the command's exit code even when RTK summarizes the result as `ok`.
- Use `rtk proxy` when exact output matters: errors, test failures, commit hashes,
  deployment responses, permission checks, HTTP headers, or other production
  evidence. If an RTK summary omits evidence needed for a claim, repeat the
  read-only check through `rtk proxy` rather than guessing.
- RTK does not replace the TOF boundary guard, tests, provider scoping, or live
  verification. Do not bypass RTK or weaken a guard merely to make a command
  succeed; diagnose a discrepancy and report it.

The older `.claude/skills/tof-edit/SKILL.md` and historical deployment notes do
not override this file. In particular, their automatic direct-to-main workflow,
old checkout paths, and claims of relationships with other leagues do not apply.
The user makes requests here; do not contact Carl or another person to resolve
questions unless the user explicitly asks you to send a message.

Treat frontend deployments, Supabase migrations and Edge Function deployments
as separate operations. Before a release, identify which operations are needed
and their ordering so the UI and backend remain compatible. Do not apply all
pending migrations or merge another PR as a side effect of a focused change.
Keep the live website on the allowlisted project throughout any account-role
changes; a proposed ownership arrangement is not evidence it already happened.

## Limits of these guards

The local pre-push hook blocks ordinary pushes to other repositories and direct
production pushes. The preflight checks pinned local identities. Agent
instructions govern tool use. These are not an OS sandbox, cannot restrict
account-wide credentials, and do not intercept direct API/CLI cloud writes.
Never describe this workspace as technically incapable of reaching elsewhere.
