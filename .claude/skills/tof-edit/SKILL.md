---
name: tof-edit
description: The editing room for Carl's Top of the Falls app. Use for ANY change,
  edit, fix, tweak, addition or removal Carl Higgins asks for in the TOF league app —
  UI copy, screens, rules, league settings, admin tools, emails, bugs, migrations.
  Takes Carl's request in his own words and carries it all the way to deployed,
  without routing product decisions back to Chase. Triggers on "Carl wants",
  "Carl asked for", "Carl says", "change the app", "/tof-edit", or any TOF change request.
---

# The TOF editing room

This is a **change room**, not a review room. Something comes in as a request
from Carl; something goes out as a deployed change and a plain-English report he
can read. Nothing else happens here.

Chase does not want to be asked for permission on product decisions. Carl is the
league operator. **Carl asking for it is the authorization.** Read the autonomy
contract below and then act on it — do not open a discussion about whether the
change is a good idea unless it hits one of the four stop conditions.

---

## 0. Identity lock — read before touching anything

This repo is **Carl Higgins' own instance** of Top of the Falls. Three sibling
apps are built from this codebase. Only ever touch this one:

| | GitHub | Vercel | Supabase ref |
|---|---|---|---|
| **This repo — Carl's** | `TopFalls/Topofthefalls` | `topofthefalls` (team `tof2`) | `dpbgdisezxlttwrxqanu` |
| Upstream TOF — Chase's | `cdalin1985/TOF` | `tof-app` | `sqcqmovskpoyutfyslym` |
| TOC.Monster | `cdalin1985/claude-agent0toc` | `toc-app` | `toc1` |

`sqcqmovskpoyutfyslym` and `toc1` are **forbidden literals** in this repo. Carl's
players use this database; a write that lands in the wrong project is the single
worst outcome available here. If the target is ever ambiguous:

```bash
cd /c/Users/cdali/Downloads/Topofthefalls && git remote -v && cat .vercel/project.json
```

Two hazards were already removed and must never come back:
1. A hardcoded Supabase URL/anon-key fallback in `src/lib/supabase.ts` (it throws now).
2. A cron keepalive in `.github/workflows/keepalive.yml` that pinged upstream.

---

## 1. Intake

Take Carl's request **verbatim** — a text, a voice-note transcript, a
half-sentence. Do not ask Chase to translate or clarify it first. Carl writes
like a league operator, not a product manager; "the challenge board is showing
guys who quit" is a complete and actionable spec.

Restate it in one line as an outcome before you start. If the request is
genuinely ambiguous *and* the readings produce materially different work, pick
the reading that matches how the league actually runs, build it, and name the
assumption in the report. Only a true coin-flip that can't be undone earns a
question — and that question goes to **Carl**, phrased for Carl, not to Chase.

---

## 2. Autonomy contract

### Ship it. Don't ask.

Build, verify, commit to `main`, deploy, report. This is the default for:

- UI copy, labels, wording, tone, ordering, colors, layout, icons
- New or reworked screens, components, filters, sorts, empty states
- League settings Carl controls — cooldowns, thresholds, challenge windows,
  discipline lists, venues, rank rules
- Bug fixes of any size
- Admin tooling and admin-only views
- Notification and email copy
- Additive migrations: new tables/columns with defaults, new indexes, new RLS
  policies, new edge functions
- Anything Carl asked for that is reversible by another commit

### Four stop conditions — and only four

Everything else ships. Stop and raise it with Chase only when the change would:

1. **Cross the instance boundary** — point this repo's code, env, CI or CLI at
   the upstream TOF or TOC.Monster Supabase/Vercel/GitHub project.
2. **Irreversibly destroy live data** — `DROP`, `TRUNCATE`, an unscoped `DELETE`,
   or a mass `UPDATE` on player/match/treasury rows with no snapshot and no undo.
   (The existing `stats_reset_events` snapshot pattern in
   `20260806121000_admin_stats_reset.sql` is the model: if you can build the
   change *with* an undo, that's not a stop condition — just build it.)
3. **Touch secrets or auth config** — `.env`, service-role keys, SMTP
   credentials, auth providers, lockfiles.
4. **Move real money** — switching treasury from ledger to live payment
   processing, or wiring a payment provider.

These four are not product judgment calls. They're the ones where being wrong
can't be fixed by a follow-up commit, which is exactly why they're the only ones
left on Chase's desk.

### Canon changes: ship, then update canon

If Carl asks for something that contradicts `CLAUDE.md` league canon — the
clearest example being anything that reintroduces seasons — **he is changing the
rule, and he's allowed to.** Build it, update the canon section of `CLAUDE.md` in
the same commit, and flag it in bold in the report so Chase sees the rule moved.
Don't block on it.

---

## 3. Where things live

```
src/pages/          16 screens — HomePage, RankingsPage, ChallengesPage,
                    ChallengePage, MatchPage, MatchesPage, PlayerPage,
                    ClaimPage, LoginPage, SettingsPage, TreasuryPage,
                    AdminPage, AdminStatsPage, ActivityPage,
                    NotificationsPage, AuthCallbackPage
src/lib/            supabase.ts (throws without env — leave it that way),
                    edgeFunctions.ts, ladder.ts, leagueStats.ts, treasury.ts
src/types/          database.ts — hand-maintained, drifts constantly (see §4)
supabase/functions/ add-player, claim-player, create-challenge, manage-treasury,
                    rank1-compliance, resolve-dispute, respond-to-challenge,
                    send-push, set-player-active, submit-result,
                    update-match-score
supabase/migrations/ 47 files, timestamp-prefixed
docs/tof-change-log.md  the running record of everything this room ships
```

---

## 4. Traps this app has actually fallen into

Check these every time. Each one has bitten before.

**Schema drift — SQL updated, TypeScript not.** This has caused four separate
bugs. A change is not done when the migration is written. For anything touching
the schema, walk all four layers and confirm each:

1. the migration in `supabase/migrations/`
2. the live database (query it — don't trust the migration files alone)
3. **every** edge function in `supabase/functions/` that reads those columns
4. `src/types/database.ts` and the client code using it

Never conclude from one layer what the other three are doing.

**No seasons.** The league runs continuously. No season start, no offseason, no
rollover. Never write "season" in UI copy, admin labels, emails or customer docs
— say "the list" or "clearing the board." The `player_season_stats` table and
`20260806122000_add_season_challenge_counters.sql` keep their inherited names
because edge functions and types depend on them; nothing user-facing says it.

**Mojibake.** This is a Windows checkout, and smart quotes, apostrophes and
dashes have reached players as garbled Latin-1 before — a match headline in the
activity feed and a push title (fixed in 5424462). `test/text-encoding.test.mjs`
now scans every tracked source file, so `npm run test` is the check. If it
fires, re-save the offending file as UTF-8. **Never exclude a path from that
test to make it pass** — and don't paste example mojibake into a repo file, or
the guard will correctly flag your own documentation.

**Records are private.** `20260809120000_restrict_stats_visibility.sql`
deliberately restricts who sees what. Don't widen stats visibility as a
convenience while doing something else.

**Carl is the sole super_admin** (`cj_higgins@msn.com`). Upstream signup triggers
hardcoded four personal admin emails; they are demoted here and must not return.

---

## 5. Verify before shipping

Non-negotiable, in order:

```bash
cd /c/Users/cdali/Downloads/Topofthefalls && npm run build && npm run test
```

Then, sized to the change:
- Touched the claim/auth flow? Run the `claim-flow-auditor` agent.
- Wrote a migration? Run the `supabase-migration-reviewer` agent.
- Changed a customer-facing screen? Run the `demo-readiness-checker` agent.

If a gate fails, fix it and re-run. Never report a change as shipped on a red
build, and never describe a skipped gate as passed.

---

## 6. Ship

Commit to `main` (this repo deploys from `main`; no PR unless Chase asks). One
commit per request where possible, message in the repo's existing voice — plain
sentences describing the outcome, e.g. *"Build the inactive lifecycle and the
wash, from Carl's answers."* Push, then confirm the Vercel deploy on
`topofthefalls` actually went green before calling it done.

---

## 7. Report — write it for Carl

Chase forwards these. No jargon, no file paths, no commit SHAs in the body.

```
What you asked for: <his request, one line>
What it does now:   <the new behavior, in league terms>
Where to see it:    <screen name and how to get there>
Anything to know:   <assumptions made, or "nothing">
```

Then, separately for Chase: files touched, commit, deploy status, gates run, and
anything that hit a stop condition or moved canon.

---

## 8. Log it

Append an entry to the top of `docs/tof-change-log.md` in the same commit. That
log is how Chase stays out of the loop without losing the thread — if it isn't
logged, he has no way to audit what this room did.

---

## 9. Snippets handed to Chase must be PowerShell-safe

The `bash` blocks above are for the Bash tool. **Chase's terminal is Windows
PowerShell 5.1**, where `&&` is a parser error, not a chain operator. Anything
written for him to paste must run there:

- No `&&`. Use `;` for unconditional, or `<cmd>; if ($?) { <cmd> }` for conditional.
- Drop the `cd` entirely — the working directory is already this checkout.
- No `cat`, `head`, `tail`, `which`, `touch`, `2>/dev/null`.
- One command per fenced block, so the Run button does one thing.
