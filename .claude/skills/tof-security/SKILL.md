---
name: tof-security
description: Security gate for the Top of the Falls app (Vite SPA + Supabase edge functions, RLS, guest views). Use before shipping or reviewing ANY change that touches sign-in or login, the claim flow, edge functions, SQL migrations, grants, RLS policies, views, push notifications, guest or admin access, secrets or env vars, or user data such as phone numbers. Also use when asked to "audit", "check security", "is this safe", "harden", or "review before deploy". Run it even if the change looks small, because most real flaws here are a missing server-side check or an over-broad grant, not a typo.
---

# TOF security gate

Why this exists: the league's data sits behind Supabase RLS, six deliberately public guest views, and edge functions that run with the service-role key. A single missing `auth.getUser` or one over-broad grant exposes the whole roster. Research on AI-written apps keeps finding the same cause — a security rule nobody stated — so this skill states them for this stack.

`AGENTS.md` and `CLAUDE.md` still govern. This skill adds checks; it never authorises production writes, deploys, or crossing the isolation boundary.

## Run order

1. **Scan.** From the repo root:
   ```bash
   .claude/skills/tof-security/scripts/tof-guard.sh
   ```
   It is read-only, makes no network calls, and exits 1 on any CRITICAL or HIGH. Read its real output; do not pipe it into `tail`, which would hide the exit code.
2. **Apply the gate for what you changed** (below). The script cannot judge intent, so this part is yours.
3. **Live state, only if grants, RLS, views or functions changed.** Migrations alone cannot prove the final state, because history grants and later revokes. Use the read-only queries in `references/live-checks.md`, against project `dpbgdisezxlttwrxqanu` only, and only with the user's approval per `AGENTS.md`.
4. **Report** findings as a table (severity, file:line, one plain sentence). Fix CRITICAL/HIGH in the change. List the rest. Never describe unverified work as secure.

## Things that look like findings and are not

- **The six guest views are `security_definer` on purpose** (`public_players`, `public_rankings`, `public_player_metrics`, `public_activity_feed`, `public_live_matches`, `public_league_settings`). Supabase's linter reports them as `security_definer_view` ERRORs. Do not flag them and do not "fix" them: switching to `security_invoker` returns nothing to `anon` and silently kills guest browsing and the live scoreboard. Their `WHERE` clause and explicit column list are the boundary.
- `rank1-compliance` has no auth because it is retired and answers 410.
- `Access-Control-Allow-Origin: *` on edge functions is acceptable here because auth is a bearer token, not a cookie. Revisit if cookies are ever introduced.
- Stack traces passed to `console.error` stay on the server. Only a stack inside a `Response` is a leak.

## Gates by change type

**Edge function added or changed.** It verifies the caller with `auth.getUser`, then checks this caller may touch this record (participant, admin, owner). Identity comes from the session, never the request body. Input is validated; unknown fields are rejected. Errors return a generic message; the detail goes to `console.error`. Copy the guard from sibling functions, since a new function missing its siblings' auth is the classic miss. A function meant to be public carries a `// tof-guard: public` comment with the reason.

**Migration, grant, RLS or view.** New table: enable RLS and write the policy in the same migration. Never `USING (true)` or `WITH CHECK (true)` on anything with personal or ledger data. `anon` keeps SELECT on the six views and nothing else; adding a column to a guest view is a deliberate act that `test/guest-access.test.mjs` should argue with. `SECURITY DEFINER` functions set `search_path` and check who is calling. Forward-only migrations; never `supabase db push` (see `CLAUDE.md`).

**Sign-in with phone number and PIN.** These are the checks the plan depends on:
- A 4-digit PIN has 10,000 values, so lock out after repeated failures per account and per IP, server-side, before anything else ships.
- Wrong name, wrong phone and wrong PIN return the same message, so nobody can learn who is in the league.
- The PIN and phone number never appear in logs, URLs, error bodies, localStorage, or any `anon` view. Phone numbers are personal data: admins and the owner see them, other players do not.
- Existing email accounts are not claimable by name and phone alone; they prove identity once (email code) before setting a PIN, otherwise anyone who knows a name and number takes over a player and can enter scores.
- Guest accounts have no player row and no admin reach; confirm every edge function rejects them for member actions.

**Push notifications.** Subscriptions are readable and writable only by their owner (RLS). `send-push` stays admin-only. Any dispatcher that sends on behalf of scheduled jobs is authenticated with a secret that is not in the browser bundle. Payloads carry no scores-in-progress for private matches, no phone numbers, no PINs. Followed-player alerts for guests use the same public data guests can already read.

**Anything touching secrets.** `VITE_` variables are public by definition: only the Supabase URL, anon key, VAPID public key and payment links belong there. Never read or print `.env*`. A secret that ever reached git history needs rotating, not just deleting.

## When something is unclear

If a rule, role or data field isn't stated in the code or `CLAUDE.md`, ask rather than guess. A wrong guess here becomes a roster leak.

## Reference

- `references/checks.md` — the checks behind the script and gates, and which upstream categories were deliberately dropped.
- `references/live-checks.md` — read-only SQL for the live project.
- `references/ATTRIBUTION.md` — upstream sources and licences.
