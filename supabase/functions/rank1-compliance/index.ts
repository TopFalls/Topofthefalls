import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Retired.
 *
 * This function enforced a rank-1 obligation inherited from TOC: the #1 player
 * had to beat two top-5 opponents within 30 days or be demoted to #10. Carl's
 * Top of the Falls rules contain no such rule, and 20260615120000 already
 * turned the database side into a no-op — but this function survived, could
 * still start a 30-day clock by writing rankings.rank1_since, and reported
 * "compliance" for a rule that does not exist.
 *
 * It is answered rather than deleted so any bookmark, cron entry or admin tool
 * still pointing at it gets a clear answer instead of a confusing success.
 */
serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  return new Response(
    JSON.stringify({
      error: 'Retired. Top of the Falls has no rank-1 obligation, so there is nothing to check or enforce.',
    }),
    { status: 410, headers: { ...cors, 'Content-Type': 'application/json' } },
  );
});
