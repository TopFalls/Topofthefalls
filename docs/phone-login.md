# Phone + PIN sign-in (replaces email)

Chase, 2026-10-01: *"I want the email eliminated from the application one hundred percent."*

The app no longer asks for, shows, sends or uses an email address. Members pick
their name from the league list and sign in with a phone number and a 4-digit PIN.

## What a person sees

| Who | What they do |
| --- | --- |
| Already signed in (most of the league) | One screen, once: enter a phone number, choose a PIN. No code, no approval. |
| Signed out, or one of the unclaimed names | Pick their name, enter phone + PIN, **Ask to Join**. A league admin approves it under **Admin → Sign-ins**. |
| Admin | **Admin → Sign-ins** lists who is waiting, with the phone number to ring back. Approve, turn down, or clear a lockout. |
| Forgot the PIN / new phone | Ask to join again with the same name. Approving replaces the old phone + PIN. |

Nothing is ever sent to a phone. The phone number is a password, not a way to reach anyone.

## How it works

* `login_credentials` — one row per player who can sign in: salted PBKDF2-SHA256
  hash of phone + PIN (600,000 rounds), and the last four digits of the phone.
  The browser roles have **no access** to it or to the two tables below.
* `login_requests` — a signed-out member asking in. The phone number is kept
  here in the clear **only until an admin decides**, so they can ring back; it is
  wiped on approve and on reject.
* `login_attempts` — the lockout. Every try is counted **before** the secret is
  checked: 5 per player per 15 minutes, 40 per address per 10 minutes. A lock
  doubles each time (15 min, 30 min, … capped at 24 h) and is forgotten after a
  quiet day.
* Sign-in goes by **player id**, chosen from the list. A typed name is never used,
  so spelling, case and later renames cannot break it.
* Edge functions: `phone-login` and `phone-request` (public: they run before
  there is a login), `switch-to-phone` (needs a login), `manage-phone-login`
  (admins only).
* Supabase Auth still needs an identifier on every account. Accounts created from
  here on carry a placeholder `u-<id>@phone-login.invalid` that cannot be mailed
  to and that nothing in the app shows or uses. A session is minted on the server
  from an admin link that is redeemed immediately and never emailed.

## What an approved name inherits

If the name already has an account, approval keeps it, so match history, stats and
any admin role carry over. Only a never-claimed name gets a new account.

## Known limits (honest list)

* A 4-digit PIN is 10,000 values. The lockout is what makes that safe; it is not
  safe without it. A longer PIN is a one-line change in `phoneAuth.ts` + the forms.
* Someone can lock a name out by guessing at it. An admin clears it under
  **Admin → Sign-ins → Locked out?**
* Approval is a human check. The admin screen warns when the name has admin
  access, and nobody can approve their own request.
* The address counter trusts `cf-connecting-ip`, falling back to
  `x-forwarded-for`. If neither is trustworthy the per-player counter still holds.
* Supabase rate-limits token redemptions per address (default 30 per 5 minutes).
  A busy league night from one edge address could in theory hit it. Unverified
  here; if sign-ins start failing with a rate-limit error, raise it in Auth →
  Rate Limits.
* Guests (no account, browse + follow with push) are **not** part of this change.
  They will be built with the follow-notifications feature, with no database
  access beyond the six public views.
* The stored real email addresses are **hidden, not deleted**. Delete them only
  after everyone has switched, as a separate, explicit step. The Brevo SMTP and the
  two email templates in `supabase/config.toml` are unused by the app and are
  retired in that same later step.
