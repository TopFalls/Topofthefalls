---
name: tof-release
description: Prepare, release, and verify changes for the Top of the Falls app across TopFalls/Topofthefalls, its pinned Supabase project, and its pinned Vercel project. Use for TOF pull requests, coordinated frontend or backend releases, deployment checks, and rollback planning.
---

# TOF Release

Carry a reviewed TOF change from a feature branch through the exact operations it
requires. Read the repository-root `AGENTS.md` first and run its boundary guard at
the start and again before every remote mutation. Stop if any target differs from
the allowlist.

## Define the release unit

Inspect the diff and classify every changed artifact:

- frontend or hosting configuration: GitHub merge followed by the existing
  GitHub-to-Vercel deployment
- Edge Function: deploy only the named changed function to
  `dpbgdisezxlttwrxqanu`
- migration: apply only the reviewed migration to that same project
- documentation or tests: no cloud deployment unless another changed artifact
  requires it

State the required operations and their safe order. Keep compatible frontend and
backend behavior during partial rollout. Never deploy all functions or all pending
migrations as a shortcut.

## Prepare reviewable evidence

Work on a feature branch. Run the checks required by `AGENTS.md`, inspect the
final diff, and confirm the branch contains only the intended change. Create or
update a pull request only when authorized by the user's request. Include the
problem, resulting behavior, deployment units, validation, and any rollback
constraint.

Before merge or any production write, present the concrete commit/PR and the exact
GitHub, Supabase, or Vercel operation awaiting approval. Honor approval already
given for that operation; do not ask twice.

## Release and verify

Use explicit targets on every provider command. Capture exact output with `rtk
proxy` when it establishes identity, deployment status, commit SHA, or failure.
After release, verify each deployed unit separately:

- GitHub: merged SHA is the reviewed SHA
- Vercel: deployment belongs to project `prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo`
  and team `team_TiDDLGgPBC8TlMQKmrNcFNl8`
- Supabase: the changed function or migration is present in project
  `dpbgdisezxlttwrxqanu`
- production: the canonical site exhibits the requested behavior

A merged PR, green build, or successful CLI response is intermediate evidence.
Report `local`, `preview`, `deployed`, and `verified live` distinctly.

## Failure and rollback

Stop when a provider rejects access or identity cannot be proven. Do not switch
accounts, teams, repositories, or projects. Determine whether the safest recovery
is a frontend revert, an Edge Function redeploy, or a forward database fix; do
not claim database migrations are automatically reversible. Obtain authorization
for the concrete recovery mutation unless it was already granted.

