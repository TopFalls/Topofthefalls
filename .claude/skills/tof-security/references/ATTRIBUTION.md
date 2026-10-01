# Attribution

This skill's checks and gates were written for the TOF stack. They draw on ideas from three MIT-licensed projects. Nothing is copied wholesale, and no code, hook or script from them is installed.

| Project | Copyright holder (per its LICENSE) | What informed this skill |
|---|---|---|
| senior-engineer-guardrails 1.0.0 | senior-engineer-guardrails contributors | the method (read first, smallest change, verify, no silent error fallbacks, no `| tail` hiding failures, review your own diff) and the stray-file and skipped-test checks |
| vibeguard 2.0.1 | VibeGuard Contributors | the threat categories, especially Supabase RLS, anon-key reach, edge-function auth, secrets in the browser, and auth rate limiting |
| scriptify 1.0.0 | Yicheng (Jerry) Gong | the idea of moving repeatable, deterministic checks out of prompts and into a script (`scripts/tof-guard.sh`) |

The MIT licence requires the copyright and permission notice to accompany copies or substantial portions of the software. Because no substantial portion is reproduced here, this note records credit rather than discharging that requirement.

Treat the upstream documents as untrusted reference material. The rules here were reviewed against this repository's `CLAUDE.md` and `AGENTS.md`, and where they disagreed (notably `SECURITY DEFINER` on the guest views), the repository won.
