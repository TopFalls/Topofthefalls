# Objective

Implement eight league-rule and privacy changes for the Top of the Falls pool
league app, requested by the league operator. When done: the treasury is
readable only by admins (it is currently world-readable by the anonymous API
key), the ladder moves by a straight two-player swap instead of a cascade, an
ignored challenge counts as a forfeit, Saratoga is open to every player, the
one-spot-at-a-time rule covers the Top 10 rather than the Top 11, successfully
defending clears a post-loss cooldown, an admin can override a wash's automatic
penalties, and a second account is granted admin.

Every SQL change ships as a **migration file only**. Do not run migrations, do
not connect to any database, do not call any Supabase CLI or MCP command. A
human applies them after review.

# Context

Stack: Vite + React 19 SPA (TypeScript) + Supabase (Postgres, RLS, Deno edge
functions). `npm run build` = `tsc -b && vite build`. Tests are `node --test`
files under `test/`, run with `npm run test`.

## Files that matter

- `supabase/migrations/` — 48 timestamped SQL files. Newest is
  `20260810140000_inactive_lifecycle_and_wash.sql`. **Follow the existing style
  exactly**: a comment block at the top explaining *why* in plain English and
  quoting the league rule it implements, then `-- ─── Section ───` dividers.
  Read `20260809120000_restrict_stats_visibility.sql` as the reference for a
  privacy migration and `20260810120000_align_rules_with_league_document.sql`
  for a rules migration.
- `supabase/functions/create-challenge/index.ts` — challenge eligibility. Local
  `canChallenge(myPos, theirPos, challengeRange)` at line 25. Saratoga gate at
  lines 126-130. Cooldown check at lines 147-164.
- `supabase/functions/submit-result/index.ts` — `applyPostMatchCooldowns()` at
  line 211, `confirmResult()` at line 240, `cascade_ranking_after_win` RPC call
  at line 270.
- `supabase/functions/respond-to-challenge/index.ts` — calls
  `apply_challenge_decline_forfeit` at line 100.
- `src/lib/ladder.ts` — client-side copy of the same challenge rules.
  `challengeEligibility()` at line 11.
- `src/pages/TreasuryPage.tsx` — treasury UI.
- `test/ladder.test.mjs`, `test/league-rules.test.mjs`,
  `test/stats-privacy.test.mjs` — these pin the rules you are changing and
  **will fail** until you update them.

## The critical pattern in this repo

Rules are duplicated between the client (`src/lib/ladder.ts`) and the server
(`supabase/functions/*/index.ts`), and there is a documented history of one
being changed while the other was missed. Both files say "keep the two in step".
**Any rule you change must be changed in both places, and the tests updated to
match.** This is the single most likely way to get this task wrong.

# Steps

## 1. Treasury becomes admin-only

New migration `supabase/migrations/20260814120000_restrict_treasury_visibility.sql`.

Current state: table `public.treasury_ledger` has RLS enabled with a policy
named `"Anyone can view treasury"` whose expression is `USING (true)`, and it is
granted to `anon`. Views `public.treasury_summary` and
`public.treasury_ledger_effects` have no RLS and are granted to `anon`.

- `DROP POLICY IF EXISTS "Anyone can view treasury" ON public.treasury_ledger;`
- Create a SELECT policy for `authenticated` using
  `public.is_league_admin()`. That function already exists — created in
  `20260809120000_restrict_stats_visibility.sql`. Do not write a new one.
- `REVOKE ALL ON public.treasury_ledger FROM anon;` and the same for both views.
- Ensure both views are `security_invoker = on` so they inherit the policy
  rather than bypassing it. Copy the approach in
  `20260802120000_admin_dashboard_views_security_invoker.sql`.
- Leave the existing insert policy (`"Super admins can insert treasury entries"`)
  alone.

Then update `src/pages/TreasuryPage.tsx`: non-admins must see a plain
"Treasury is admin only" state, not an error or an empty broken table. Read how
`src/pages/AdminStatsPage.tsx` line 142 checks
`['admin','super_admin'].includes(profile.role)` and follow that pattern.

## 2. Ladder becomes a swap, not a cascade

New migration `supabase/migrations/20260814121000_ladder_swap_on_win.sql`.

The league rule: *"Challenger takes spot, the loser goes to the challenger's
spot."* A straight two-row exchange. Nobody positioned between them moves.

`CREATE OR REPLACE FUNCTION public.cascade_ranking_after_win(p_winner_id uuid,
p_loser_id uuid)`. Keep the name, signature, `SECURITY DEFINER`,
`SET search_path TO 'public'`, the
`LOCK TABLE public.rankings IN SHARE ROW EXCLUSIVE MODE`, and the existing guard
that returns early when `v_winner_pos <= v_loser_pos` (a defending winner must
move nobody). Replace only the body: winner takes the loser's position, loser
takes the winner's old position, `previous_position` set on both rows,
`updated_at = now()`.

The existing body parks rows at `position + 1000` to dodge the unique
constraint. You will need the same kind of temporary offset for a two-row swap.

**Before finishing, grep the whole `supabase/` tree for
`cascade_ranking_after_win` and list every caller in your report.** If a forfeit
path moves the ladder by its own SQL rather than calling this function, it must
be changed to swap too, or the two paths will disagree.

## 3. An ignored challenge counts as a forfeit

New migration `supabase/migrations/20260814122000_expiry_counts_as_forfeit.sql`.

`public.expire_stale_challenges()` currently only does
`UPDATE challenges SET status = 'expired' WHERE status = 'pending' AND
expires_at <= NOW()` and returns a count. No loss is recorded.

A *declined* challenge already does the right thing via
`public.apply_challenge_decline_forfeit(...)`, which writes ranking, cooldown,
stats, activity feed and notifications, and has a matching
`public.reverse_challenge_decline_forfeit(...)` so an admin can undo it. Read
both before you start.

Rewrite `expire_stale_challenges()` to loop over each newly expired pending
challenge and put it through that same forfeit path, so an ignored challenge is
recorded exactly like a declined one and stays reversible. Do not duplicate the
forfeit logic — call the existing function. Keep the return type `integer` and
keep returning the number of challenges affected.

## 4. Saratoga opens to all players

Delete the top-20 gate at `supabase/functions/create-challenge/index.ts` lines
126-130 (the `if (discipline === 'Saratoga' && (myPos > 20 || theirPos > 20))`
block and its comment).

Search `src/` for any client-side copy of the same restriction — check
`src/config/league.ts` and `src/pages/ChallengePage.tsx` — and remove it there
too. Report what you found.

## 5. Top 11 becomes Top 10

The rule is already implemented but covers the wrong band. It must key off the
challenger's own rank.

- `supabase/functions/create-challenge/index.ts` line 39: `if (myPos <= 11)`
  becomes `if (myPos <= 10)`. Update the message on line 41 to say Top 10.
- `src/lib/ladder.ts` line 14: `if (myPos <= 11)` becomes `if (myPos <= 10)`,
  and the reason string on line 17 becomes "Top 10: one spot up only".
- `src/lib/ladder.ts` lines 19-23 special-case `myPos === 12` to allow #11 or
  #10. Once the band is 10, that branch is exactly what the default two-spot
  rule already produces, so **delete it** — leave one rule, not two that agree
  by coincidence.
- Both files carry comments saying "Top 11"; update the prose too.

Note these positions are *active ranks* (inactive players are skipped), not raw
list positions. Do not change that behaviour.

## 6. Defending clears a post-loss cooldown

The rule: *"If you are challenged and defend, you may challenge up."* A player
under a 7-day post-loss cooldown who successfully defends should be free again.

In `supabase/functions/submit-result/index.ts`, inside `confirmResult()`: when
the winner did **not** move up — meaning they were the higher-seeded defender —
delete that winner's outstanding rows from `cooldowns` where
`type = 'post_match'` and `expires_at > now()`. `winnerMovedUp` is already
computed at line 262. Do not touch the loser's cooldown.

Add a short comment explaining the rule, in the style of the existing rule-5
comment block above `applyPostMatchCooldowns` at line 200.

## 7. Wash penalties become an overridable default

New migration `supabase/migrations/20260814123000_admin_override_wash.sql`.

Read `supabase/migrations/20260810140000_inactive_lifecycle_and_wash.sql` first.
Today a wash automatically sits the challenger for 24 hours (a `cooldowns` row
of type `wash`) and lets the challenged player challenge up immediately.

Keep that as the default. Add a `SECURITY DEFINER` function, admin-only, that
lets an admin clear or shorten the wash cooldown on a given player — gate it
with `public.is_league_admin()` and follow how the other admin-only functions in
that migration are locked down. Grant execute to `authenticated` only.

Surface it in `src/components/admin/AdminAlertsCard.tsx`, where wash alerts
already appear, as a control on the alert.

## 8. Grant a second admin

New migration `supabase/migrations/20260814124000_grant_second_admin.sql`.

`UPDATE public.profiles SET role = 'admin'` for the account whose auth email is
`disturbingiraq@gmail.com` (this is Mike Birkoski, who has already signed in and
claimed his roster row). Look the id up by joining `auth.users` on email inside
the migration — do not hardcode a UUID. Make it idempotent and a no-op if that
account is missing.

Then update `CLAUDE.md`: its "League canon" section states there is a single
super_admin on this instance. Amend it to record that a second account now holds
`admin` (not `super_admin`), and why. Keep the existing warning that the
upstream signup trigger's four hardcoded personal admin emails must not return —
that is a separate thing and still true.

## 9. Tests

Update the tests that pin the rules you changed — `test/ladder.test.mjs`,
`test/league-rules.test.mjs`, `test/stats-privacy.test.mjs`. Match the existing
style: `node:test` with `node:assert/strict`, plain-English test names
describing the league rule.

Add coverage for: the Top 10 boundary (a player at #10 may only reach #9; a
player at #11 may reach #9 and #10), the swap leaving a middle player untouched,
and the treasury migration revoking `anon`.

Several tests assert against migration file *contents* by reading the SQL —
follow that pattern rather than inventing a database-backed test.

# Constraints

- **Do not run any migration, and do not connect to a database.** No
  `supabase db push`, no `psql`, no MCP calls. Write `.sql` files only.
- Do not touch `.env`, any secret, `package-lock.json`, `node_modules/`, or
  `dist/`.
- Do not add dependencies.
- Do not modify anything under `docs/`, `.claude/`, or any existing migration
  file. New migrations only — migrations already applied are immutable history.
- Do not change the Supabase project ref, URL, or any deployment target. The
  strings `sqcqmovskpoyutfyslym` and `toc1` belong to other deployments and must
  never appear in this repo.
- Do not rename `player_season_stats` — edge functions and generated types
  depend on it.
- Never write the word "season" into any user-facing string. This league runs
  continuously and has none. The table name is inherited and stays.
- Do not deploy anything.

# Acceptance criteria

- [ ] `supabase/migrations/20260814120000_restrict_treasury_visibility.sql`
      drops the `USING (true)` policy, adds an `is_league_admin()` policy,
      revokes `anon` on the table and both views, and sets `security_invoker` on
      both views.
- [ ] `TreasuryPage.tsx` shows a non-error admin-only state for non-admins.
- [ ] `cascade_ranking_after_win` swaps exactly two rows; a player positioned
      between winner and loser keeps their position.
- [ ] The early-return guard for a defending winner is still present.
- [ ] Every caller of `cascade_ranking_after_win` is listed in the report.
- [ ] `expire_stale_challenges()` routes expired challenges through
      `apply_challenge_decline_forfeit`, still returns `integer`, and the result
      is reversible by the existing reverse function.
- [ ] The Saratoga top-20 block is gone from `create-challenge/index.ts`, and
      any client-side copy is gone too.
- [ ] `myPos <= 10` in **both** `create-challenge/index.ts` and
      `src/lib/ladder.ts`; the `myPos === 12` branch is deleted; all "Top 11"
      prose updated.
- [ ] `submit-result` deletes the defending winner's live `post_match` cooldown
      rows and leaves the loser's alone.
- [ ] An admin-only, `is_league_admin()`-gated function can clear a wash
      cooldown, and a control for it exists in `AdminAlertsCard.tsx`.
- [ ] The second-admin migration resolves the id by email and is idempotent.
- [ ] `CLAUDE.md` records the second admin.
- [ ] `npm run build` exits 0.
- [ ] `npm run test` exits 0 with every test passing.
- [ ] No file outside the repo was written, and no migration was executed.

# Verification

Run these and paste the real output — not a summary:

```
npm run build
npm run test
grep -rn "cascade_ranking_after_win" supabase/
grep -rn "myPos <= 1" src/lib/ladder.ts supabase/functions/create-challenge/index.ts
grep -rn "Saratoga" src/ supabase/functions/
git status --short
git diff --stat
```

Expected: build exits 0; every test passes; the two `myPos <= 10` sites both
appear and no `<= 11` remains; no Saratoga top-20 restriction remains in either
tree; `git status` shows only new migration files plus the source files named
above.

# Output contract

Report back:

1. Every file changed and why, one line each.
2. Every command you ran with its real output — especially the full test
   summary. If something failed, show the failure; do not describe it.
3. Every caller of `cascade_ranking_after_win` you found.
4. Whether a client-side Saratoga restriction existed, and where.
5. Anything in this plan you could not do, and the specific reason.
6. Anything you changed that this plan did not ask for, and why.
