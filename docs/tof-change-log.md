# TOF change log — what the editing room shipped

Every change Carl requests goes through `.claude/skills/tof-edit/SKILL.md` and
lands here. Newest first. This exists so Chase can stay out of the request loop
and still audit it afterward in one pass.

One entry per request. Keep it short — the detail is in the commit.

```
## YYYY-MM-DD — <outcome in one line>

**Carl asked:** <verbatim, however he phrased it>
**Shipped:** <what the app does now>
**Files:** <the two or three that matter>
**Commit:** <sha> · **Deploy:** green / rolled back
**Gates:** build ✓ tests ✓ <+ any agent review run>
**Flags:** <assumption made, canon moved, or stop condition hit — else "none">
```

---

## 2026-08-12 — Email sending works for the first time

**Carl asked:** (follow-on from the add-player error) — get invites actually
sending.

**Shipped:** Custom SMTP configured on the Supabase project via a Gmail relay —
`smtp.gmail.com:465`, user and sender `topofthefallsapp@gmail.com`, Google App
Password. Auth email rate limit raised 100 → 150/hour. Chase did the account
creation and credential entry; that is a stop condition and stays with him.

**Proof, not assumption:** `POST /auth/v1/recover` returned **200** and
`auth.users.recovery_sent_at` advanced to 2026-08-12 16:27:16. The first attempt
failed with Gmail `535 5.7.8 Username and Password not accepted` — an App
Password generated against the wrong signed-in Google account. Regenerating it
under `topofthefallsapp@gmail.com` fixed it.

**Also corrected:** a project memory claimed SMTP had been configured via Resend
and verified on 2026-08-02. That was false by today. Mail had never actually
sent on this project — `invited_at` was null for every user. Rewritten to
verified state.

**Files:** none — this was infrastructure, no code changed.
**Deploy:** n/a · **Gates:** n/a (no code change)

**Flags:**
- **The 6-digit code template is still unverified.** The claim screen asks for a
  code, so the magic-link template must render `{{ .Token }}` and not just a
  link. Sending works; whether the *right* email content goes out is untested.
  This is the next thing to check before anyone is invited.
- Wade Thompson (#4) is unclaimed — the old test-account holding is already
  released, contrary to what the stale memory said.

---

## 2026-08-11 — A failed invite email no longer throws away the added player

**Carl asked:** Getting an error when trying to add players to the list. Also
wants to double-check that player stats are only visible to themselves.

**Shipped:** Adding a player and emailing them an invite are now separate. The
player lands on the ladder with their ranking and stats regardless; if the
invite email fails, the admin sees an amber "added, but the invite didn't go
out" note instead of a red error, and can invite again later. Previously any
invite failure ran the rollback and deleted the player that had just been
created successfully — which is why 117 players had been on the list since the
seed and `player.added` had never once been recorded.

**Root cause:** not the schema. Every column, function and policy the code needs
is present live, no triggers can raise, and Carl's `super_admin` role is
correct. The sole failure point was `inviteUserByEmail` — `auth.users` shows
`invited_at` null for all 5 accounts, so no invite has ever been delivered on
this project. Consistent with custom SMTP still being unconfigured.

**Stats visibility — verified, no change needed.** RLS is on for
`player_season_stats`, `player_discipline_stats` and `matches`; each policy is
`is_league_admin() OR owns_player(...)`; `anon` is revoked on all three; and all
three `admin_dashboard_*` views are `security_invoker`, so they inherit those
policies instead of bypassing them. A player sees their own numbers and Carl
sees everyone's.

**Files:** `supabase/functions/add-player/index.ts`,
`src/components/admin/PlayersTab.tsx`
**Commit:** 262ff8e · **Deploy:** edge function `add-player` v1 → v2, verified live
(boots, returns its own 401 and CORS 200). Vercel frontend pushed; publish not
confirmed from here — the Vercel MCP token has no `tof2` scope and the edge was
serving a 12-hour-cached `index.html`. Not blocking: the fix is server-side, and
the old UI already renders the function's `message`, so Carl gets the player and
the explanation either way. Only the amber styling waits on the publish.
**Gates:** build ✓ · tests 97/97 ✓

**Flags:**
- Redeploying also carried a pending fix live: the old v1 still stamped
  `rank1_since` on a new #1, which contradicts TOF having no rank-1 obligation.
- The invite email itself is still not fixed — that needs custom SMTP, which is
  auth config and a stop condition. Carl can add players now; they just won't
  receive email until SMTP is set up.
- The `supabase_migrations` ledger is missing the last two migrations even
  though their objects exist live. Harmless today, but a future `db push` would
  try to replay them.
