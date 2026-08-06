-- Add the missing defender_wins column to both stats tables.
--
-- This column is written by three edge functions and rendered by the admin
-- stats dashboard, but it was never created by any migration in this repo — it
-- exists in the upstream league's database as undocumented schema drift, so
-- replaying the recovered migrations onto a clean project produced a schema the
-- application code cannot actually write to.
--
-- Impact before this fix (verified: ERROR 42703 column "defender_wins"
-- does not exist):
--   * submit-result   — confirmResult() throws when both players have
--                       submitted, so matches never reach 'confirmed' and the
--                       ranking cascade never runs
--   * resolve-dispute — admin cannot resolve a disputed match
--   * add-player      — the season/discipline stat inserts fail and the new
--                       player is rolled back
--
-- Counterpart of challenger_wins: incremented when a player wins a match they
-- did NOT initiate (i.e. successfully defending their ladder spot).

ALTER TABLE public.player_season_stats
  ADD COLUMN IF NOT EXISTS defender_wins integer NOT NULL DEFAULT 0;

ALTER TABLE public.player_discipline_stats
  ADD COLUMN IF NOT EXISTS defender_wins integer NOT NULL DEFAULT 0;

INSERT INTO public.audit_events (action, target_type, detail)
VALUES (
  'schema_repair_defender_wins',
  'player_season_stats',
  jsonb_build_object(
    'column', 'defender_wins',
    'tables', array['player_season_stats', 'player_discipline_stats'],
    'reason', 'Written by submit-result, resolve-dispute and add-player but missing from the recovered migration set; match confirmation failed without it.'
  )
);
