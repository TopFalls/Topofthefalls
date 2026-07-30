-- Roster seed intentionally disabled for this instance.
--
-- This file previously inserted a 117-player roster (real names supplied by the
-- league operator) that belongs to the upstream league's production database.
-- Seeding it here would copy personal data from one league's instance into
-- another. The same rule already applied to 20260321032616_toc_seed_data.sql.
--
-- The schema object this migration is still responsible for is kept below; only
-- the data rows were removed. The prior contents remain in git history if this
-- instance is ever meant to run the same roster.
--
-- To seed a roster for THIS league, add a new customer-specific migration named
-- <timestamp>_seed_<league>_roster.sql using `on conflict (full_name) do nothing`.

-- Required by roster upserts, which key on full_name.
create unique index if not exists players_full_name_unique
  on public.players (full_name);
