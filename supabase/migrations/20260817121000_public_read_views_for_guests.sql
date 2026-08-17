-- Guests get a look at the league without an account, and live match scores
-- become visible to everyone instead of just the two players at the table.
--
-- Carl asked for two things that turn out to be the same problem:
--
--   "matches that are using the scoreboard [should] be displayed live for
--    everyone logged in"
--   "we also want a way for guests to log in [and] get view only access to
--    rankings and the league activity"
--
-- Both need read access to data the app currently keeps behind a session.
-- `anon` has no grant on any table in this schema — that GRANT, not RLS, is
-- what stops a signed-out visitor today, and it is the right gate to keep.
--
-- So nothing here grants `anon` anything on a base table. Instead each guest
-- surface gets its own view with an explicit column list. That list is the
-- feature: a column added to `players` tomorrow is NOT published to the open
-- internet by accident. This repo has already shipped that exact bug once —
-- `treasury_ledger` was world-readable through `USING (true)` plus a grant.
--
-- The views run with the owner's rights (`security_invoker = false`), so their
-- WHERE clauses are the security boundary, not the caller's RLS.
-- `security_barrier` stops a caller's own predicate from being pushed under
-- that boundary to sniff filtered-out rows.

-- ─── The ladder ─────────────────────────────────────────────────────────────
-- `players` holds no email or phone — those live in auth.users — so a guest
-- sees the same roster card a player does.

CREATE OR REPLACE VIEW public.public_players AS
SELECT
  p.id,
  p.profile_id,
  p.full_name,
  p.is_active,
  p.created_at,
  p.updated_at,
  p.bio,
  p.preferred_discipline,
  p.avatar_url,
  p.inactive_since,
  p.inactive_drift_periods
FROM public.players p;

CREATE OR REPLACE VIEW public.public_rankings AS
SELECT
  r.id,
  r.player_id,
  r.position,
  r.previous_position,
  r.updated_at,
  r.rank1_since
FROM public.rankings r;

-- Fargo ratings are already `USING (true)` for signed-in players and are a
-- public number in pool, so guests see them too and the list reads the same.
CREATE OR REPLACE VIEW public.public_player_metrics AS
SELECT
  m.id,
  m.player_id,
  m.fargo_rating,
  m.fargo_robustness,
  m.updated_at
FROM public.player_reference_metrics m;

-- ─── League activity ────────────────────────────────────────────────────────
-- Treasury rows are admin-only as of 20260817120000. `match_fee_recorded`
-- names a player and how they paid ("Sam Doe paid the $5 match fee · Venmo"),
-- which is fine inside the league and more than a stranger needs, so it is
-- held back from guests as well.

CREATE OR REPLACE VIEW public.public_activity_feed AS
SELECT
  a.id,
  a.event_type,
  a.headline,
  a.detail,
  a.created_at
FROM public.activity_feed a
WHERE a.event_type NOT IN (
  'treasury_entry_credit',
  'treasury_entry_debit',
  'treasury_entry_corrected',
  'treasury_entry_reversed',
  'match_fee_recorded'
);

-- ─── Live scoreboard ────────────────────────────────────────────────────────
-- Only matches actually being played, and only what a scoreboard shows. No
-- winner, no payment method, no submission or confirmation flags, no challenge
-- link — a match drops out of this view the moment it stops being live.

CREATE OR REPLACE VIEW public.public_live_matches AS
SELECT
  m.id,
  m.player1_id,
  p1.full_name  AS player1_name,
  p1.avatar_url AS player1_avatar_url,
  m.player2_id,
  p2.full_name  AS player2_name,
  p2.avatar_url AS player2_avatar_url,
  m.discipline,
  m.race_length,
  m.venue,
  m.player1_score,
  m.player2_score,
  m.started_at,
  m.updated_at
FROM public.matches m
JOIN public.players p1 ON p1.id = m.player1_id
JOIN public.players p2 ON p2.id = m.player2_id
WHERE m.status = 'in_progress';

-- ─── Boundaries and grants ──────────────────────────────────────────────────

ALTER VIEW public.public_players        SET (security_invoker = false, security_barrier = true);
ALTER VIEW public.public_rankings       SET (security_invoker = false, security_barrier = true);
ALTER VIEW public.public_player_metrics SET (security_invoker = false, security_barrier = true);
ALTER VIEW public.public_activity_feed  SET (security_invoker = false, security_barrier = true);
ALTER VIEW public.public_live_matches   SET (security_invoker = false, security_barrier = true);

REVOKE ALL ON public.public_players        FROM anon, authenticated;
REVOKE ALL ON public.public_rankings       FROM anon, authenticated;
REVOKE ALL ON public.public_player_metrics FROM anon, authenticated;
REVOKE ALL ON public.public_activity_feed  FROM anon, authenticated;
REVOKE ALL ON public.public_live_matches   FROM anon, authenticated;

GRANT SELECT ON public.public_players        TO anon, authenticated;
GRANT SELECT ON public.public_rankings       TO anon, authenticated;
GRANT SELECT ON public.public_player_metrics TO anon, authenticated;
GRANT SELECT ON public.public_activity_feed  TO anon, authenticated;
GRANT SELECT ON public.public_live_matches   TO anon, authenticated;

COMMENT ON VIEW public.public_players IS
  'Guest-readable roster. Explicit column list on purpose — new columns on players are not published here unless added deliberately.';
COMMENT ON VIEW public.public_live_matches IS
  'Guest- and player-readable scoreboard for matches in progress. Scores only; a match leaves this view as soon as it is no longer being played.';
