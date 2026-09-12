# Dedicated TOF Codex workspace

Prepared 2026-09-11 at `C:\Users\cdali\Documents\Codex\TOF-Isolated`.
Fresh clone of `TopFalls/Topofthefalls`, branch `codex/tof-project-isolation`.

## Finish registration

In Codex, use **Add project** and choose the folder above. The app tool interface
available during setup could list projects but could not register a new folder.
Do not select the older Downloads checkout for this dedicated workspace.

For future setup checks or repairs, use the repository-local Codex skill at
`.agents/skills/tof-bootstrap/SKILL.md`. It verifies the pinned resources before
dependencies or the development server and does not provision, relink, migrate,
seed, or deploy as part of bootstrap.

## Pinned resources

- GitHub: `TopFalls/Topofthefalls`
- Supabase: `dpbgdisezxlttwrxqanu`
- Vercel: `topofthefalls`, project `prj_jK1NPxfyM3pJN0iXqCyGPoHTzwXo`
- Vercel team: `tof2`, ID `team_TiDDLGgPBC8TlMQKmrNcFNl8`
- Production: https://www.topofthefalls.online/
- Vercel alias: https://topofthefalls.vercel.app/

## Verified

The repository remote and GitHub API identify the exact allowed repository.
The public production domain responds successfully, and the Vercel alias now
permanently redirects to the canonical `www` domain. The live
Supabase JavaScript bundle names `dpbgdisezxlttwrxqanu.supabase.co`.
The Vercel IDs match the original checkout's local link and the PR #7 deployment
comment. These are identity checks, not proof of authenticated cloud access.

The seven guard checks pass: valid local configuration, unapproved push URL,
direct main destination, wrong Supabase environment ID, wrong Vercel environment
ID, installed hook rejecting main, and installed hook allowing a feature branch
in the correct repository. Hook tests run locally without pushing anything.

## Remaining access limitation

The Vercel CLI cannot access the pinned `tof2` scope with its current login
(`The specified scope does not exist`). Do not switch to a different project or
team as a workaround. An authorized login for this same team is required for
direct Vercel management. The user separately approved the existing GitHub to
Vercel deployment route: feature branch/PR, observe the preview status, obtain
approval for the concrete production release, merge and verify live behavior.
The direct-main push block remains active. Git-based deployment does not grant
access to Vercel billing, membership, secrets, or Supabase management. Stop on
an actual GitHub write denial or Vercel deployment rejection.
Authenticated Supabase CLI access to the pinned project was established and used
to deploy the cooldown Edge Functions on 2026-09-12. This does not authorize
unscoped project enumeration or future production changes. Do not copy credentials
from another project. A Supabase MCP connection must remain scoped to
`project_ref=dpbgdisezxlttwrxqanu`, initially read-only.

## Guards and limits

Read `AGENTS.md`. Run the following from this root before starting work:

```powershell
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\Assert-TOFBoundary.ps1
```

`docs/TOF-BOUNDARY.json` records the allowlist. The guard checks the Git root,
all remote URLs, local service links, environment targets, and hook setup.
`.tof-hooks/pre-push` rejects ordinary pushes outside the repository and direct
main/tag pushes. Only this clone's local Git hook setting was configured.

These are agent instructions and local checks, not an OS/network sandbox. They
cannot revoke access granted by global credentials or intercept every API call.
No runtime sandbox settings were changed. Production mutations and merges need
explicit approval. PR #7 remains outside this setup's authorization.

The changes are local and uncommitted. No app code, production settings, data,
secrets, migrations, or deployments were changed. No credentials were copied.
