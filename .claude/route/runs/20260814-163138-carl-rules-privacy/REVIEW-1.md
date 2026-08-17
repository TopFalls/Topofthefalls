# Review round 1

Your run was cut off by a wall-clock timeout before you wrote a final report, so
there is no report to respond to — I reviewed the working tree directly.

**The migrations and source changes are correct and I am not asking you to
change them.** Specifically: the treasury migration, the two-row swap, the
expiry-forfeit migration, the wash override, the second-admin migration, the
`create-challenge` and `ladder.ts` Top 10 edits, the `submit-result` cooldown
deletion, the `TreasuryPage` admin gate and the `ChallengePage` Saratoga removal
all pass review. Noticing that `reverse_challenge_decline_forfeit` also moves the
ladder, and giving it a branch that reverses a swap while preserving the old
cascade path for forfeit events recorded before the migration, was good work.

`npm run build` passes.

One acceptance criterion fails: **`npm run test` exits non-zero — 3 of 96 tests
fail.** All three are stale assertions pinning rules you correctly changed. You
updated `test/ladder.test.mjs` but not the other two files that pin the same
rules. This is exactly the duplicate-rule trap the plan warned about, applied to
tests rather than source.

## Defect 1 — `test/league-rules.test.mjs:36`

```
✖ rule 2 — inside the top 11 you may challenge one spot up only
```

The test name and its assertions still describe the Top 11 band. The rule is now
Top 10, keyed off the challenger's active rank.

**Correct:** rename to describe the Top 10 band and update the assertions so a
player at active rank 10 may reach only 9, and a player at 11 may reach 9 and 10.
Match how `test/ladder.test.mjs:37` now expresses this.

## Defect 2 — `test/league-rules.test.mjs:141-143`

```
✖ rule 4 — Saratoga stays keyed to the visible top 20
assert.match(createChallenge, /myPos > 20 \|\| theirPos > 20/);
```

This asserts the Saratoga top-20 gate is still present in
`supabase/functions/create-challenge/index.ts`. You removed that gate, correctly
— Saratoga is now open to every player.

**Correct:** invert it. Assert the restriction is **absent** from the edge
function, and rename the test to state the current rule ("Saratoga is open to
every player"). Do not delete the test — the league rule still needs pinning,
just in its new form.

## Defect 3 — `test/stats-privacy.test.mjs:120-121`

The same stale assertion, duplicated in a second file:

```
// Saratoga stays keyed to the visible Top 20, not active rank.
assert.match(createChallenge, /myPos > 20 \|\| theirPos > 20/);
```

**Correct:** same fix as defect 2. If this assertion only exists here because
this file happened to read `create-challenge`, and Saratoga is not really a
stats-privacy concern, it is fine to drop it from this file and keep the single
authoritative version in `league-rules.test.mjs` — say which you chose and why.

## Defect 4 — missing coverage the plan asked for

Two required tests were not added:

- **The swap leaves the middle player alone.** Assert against the SQL text of
  `supabase/migrations/20260814121000_ladder_swap_on_win.sql` that
  `cascade_ranking_after_win` touches only the two players — no `BETWEEN` range
  update over the intervening positions, and the early-return guard for a
  defending winner is still present. Several tests in this repo already assert
  against migration file contents; follow that pattern.
- **The treasury migration revokes `anon`.** Assert against
  `supabase/migrations/20260814120000_restrict_treasury_visibility.sql` that the
  `USING (true)` policy is dropped, that `anon` is revoked on the table and both
  views, and that both views are set to `security_invoker`.

## Do not

- Do not weaken, skip, or delete a test to make the suite green.
- Do not change any migration or source file — they passed review.
- Do not run migrations or touch a database.

## Done when

`npm run test` exits 0 with all tests passing, and `npm run build` still exits 0.

Report back with the full test summary output, and state which choice you made
for defect 3.
