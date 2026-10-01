# Checks behind the gate

## What `tof-guard.sh` covers (static)

| Area | Check | Severity |
|---|---|---|
| Secrets | `.env*` tracked; credential-shaped values; `service_role` in browser code; secret-looking `VITE_` names | CRITICAL / HIGH |
| Edge functions | no `auth.getUser`; error detail inside a `Response`; request data in `console.log` | HIGH / MEDIUM |
| Database | table with no `ENABLE ROW LEVEL SECURITY`; view that is neither a guest view nor `security_invoker`; `SECURITY DEFINER` function without `search_path`; anon-grant summary | MEDIUM / INFO |
| Browser | `dangerouslySetInnerHTML`, `innerHTML =`, `eval`; credential-like values in web storage; sensitive `console.log`; placeholder auth | HIGH / MEDIUM |
| Hygiene | duplicate or backup files; skipped or focused tests | MEDIUM / HIGH |

Limits: it is grep-level. It cannot judge whether an ownership check is *correct*, whether a policy is too broad, or the final live grants. That is what the gates in `SKILL.md` and `live-checks.md` are for. It was proven against a scratch repo with 15 deliberately planted flaws (all caught) and against this repo (no critical, high or medium findings at the time of writing).

## Upstream categories deliberately dropped

These do not apply to a Vite SPA + Supabase app, and keeping them would produce noise or, worse, harmful "fixes":

- **Next.js / React server** (Server Actions, route handlers, middleware matchers, `getServerSideProps`): the app has none.
- **NextAuth, Auth.js, Clerk, Lucia:** the app uses Supabase Auth.
- **LLM and prompt-injection checks:** the app has no LLM features.
- **GraphQL, WebSocket servers, Docker, XML/zip bombs, SSTI, LDAP/XPath:** not present.
- **Stripe webhooks and price manipulation:** treasury is a ledger; no real payment processing is live. Re-enable this group if payments go live.
- **Server-side file uploads / EXIF:** none today. Re-enable if avatar uploads are added.
- **The upstream advice "use `SECURITY INVOKER`, avoid `SECURITY DEFINER`".** Wrong for the six guest views here (see `SKILL.md`).
- **The upstream `harden` skill** (installs `helmet`, `express-rate-limit`): there is no Express server, and changing `package.json` or lockfiles needs explicit instruction.
- **The upstream pre-commit secret hook:** not installed. It could block legitimate commits and `tof-guard.sh` already covers secret patterns on demand. It can be reconsidered after testing for false positives on this repo.

## Categories that apply and are covered by gates rather than the script

Authorization on every entry point (IDOR, missing function-level auth, mass assignment); rate limiting and lockout on sign-in; user enumeration; weak-credential policy; race conditions on challenge and result submission (put the invariant in a constraint, not a check-then-write); CORS and security headers on the Vercel deployment; dependency hygiene (confirm a new package exists and is maintained before adding it); verbose errors.
