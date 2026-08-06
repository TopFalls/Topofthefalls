-- Second half of the same schema drift as 20260806120000 (defender_wins).
--
-- player_season_stats is missing challenges_issued and challenges_received.
-- Both are declared in src/types/database.ts and both are written by edge
-- functions, but neither was ever created by a migration in this repo.
--
-- Impact before this fix:
--   * add-player      — the season-stats INSERT names both columns, so it
--                       errors and the whole new-player creation rolls back.
--                       Admins could not add a player at all.
--   * create-challenge — selects challenges_issued / challenges_received from
--                       this table. The error is swallowed (the code only
--                       destructures `data`), so it silently skipped the
--                       counter update rather than crashing — season-level
--                       challenge counts were quietly never recorded.
--
-- The per-discipline equivalents already exist on player_discipline_stats
-- (added by 20260609133000_tof_challenge_rules.sql); these are the
-- league-wide totals.

ALTER TABLE public.player_season_stats
  ADD COLUMN IF NOT EXISTS challenges_issued integer NOT NULL DEFAULT 0;

ALTER TABLE public.player_season_stats
  ADD COLUMN IF NOT EXISTS challenges_received integer NOT NULL DEFAULT 0;

INSERT INTO public.audit_events (action, target_type, detail)
VALUES (
  'schema_repair_season_challenge_counters',
  'player_season_stats',
  jsonb_build_object(
    'columns', array['challenges_issued', 'challenges_received'],
    'reason', 'Declared in app types and written by add-player/create-challenge but missing from the recovered migration set; add-player failed outright without them.'
  )
);
