-- The treasury was still readable through the back door of the activity feed.
--
-- 20260814120000 locked down `treasury_ledger` and its two reporting views
-- because Carl's questionnaire said players should not see league money. But
-- `manage-treasury` also writes a plain-English row into `activity_feed` for
-- every entry:
--
--   "Admin added $250.00 credit to league treasury · March dues"
--
-- and `activity_feed` carried `USING (true)`. Every signed-in player could
-- reconstruct the ledger line by line from the feed. No entries exist yet, so
-- nothing has actually been disclosed, but the path was live.
--
-- Treasury rows are now admin-only. Everything else in the feed — challenges,
-- matches, rank moves, roster changes — stays visible to the whole league,
-- which is the point of having a feed.

DROP POLICY IF EXISTS "Anyone can view activity feed" ON public.activity_feed;

CREATE POLICY "League activity, minus the money" ON public.activity_feed
  FOR SELECT
  TO authenticated
  USING (
    public.is_league_admin()
    OR event_type NOT IN (
      'treasury_entry_credit',
      'treasury_entry_debit',
      'treasury_entry_corrected',
      'treasury_entry_reversed'
    )
  );

COMMENT ON POLICY "League activity, minus the money" ON public.activity_feed IS
  'Players read the league feed; treasury entries name dollar amounts, so only admins see those.';
