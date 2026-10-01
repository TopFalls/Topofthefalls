// tof-guard: public
// Called once a minute by pg_cron (job 'tof-dispatch-push'), never by a browser, so
// it cannot carry a user's login and is deployed with verify_jwt = false. It
// proves the caller with a random secret kept in the vault and checked by
// check_push_dispatch_secret(); a request without it gets a 401 and does nothing.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPush } from '../_shared/sendPush.ts';

type Notification = {
  id: string;
  player_id: string;
  title: string;
  body: string;
  reference_id: string | null;
  reference_type: string | null;
};
type AdminAlert = { id: string; headline: string; detail: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Where tapping the notification should land. */
function urlFor(n: Notification): string {
  if (n.reference_type === 'match' && n.reference_id) return `/match/${n.reference_id}`;
  if (n.reference_type === 'challenge') return '/challenges';
  return '/notifications';
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const secret = req.headers.get('x-dispatch-secret') ?? '';
    const { data: ok, error: secretError } = await supabase.rpc('check_push_dispatch_secret', { p_secret: secret });
    if (secretError) {
      console.error('dispatch-push secret check failed', secretError);
      return json({ error: 'Something went wrong.' }, 500);
    }
    if (ok !== true) return json({ error: 'Unauthorized' }, 401);

    // Claimed rows are already marked as pushed, so overlapping runs cannot
    // send the same push twice.
    const { data: notes, error: notesError } = await supabase.rpc('claim_unpushed_notifications', { p_limit: 100 });
    if (notesError) throw notesError;
    const { data: alerts, error: alertsError } = await supabase.rpc('claim_unpushed_admin_alerts', { p_limit: 50 });
    if (alertsError) throw alertsError;

    let sentToPlayers = 0;
    for (const n of (notes ?? []) as Notification[]) {
      await sendPush(supabase, n.player_id, n.title, n.body, urlFor(n), `n-${n.id}`);
      sentToPlayers += 1;
    }

    let sentToAdmins = 0;
    if ((alerts ?? []).length > 0) {
      const { data: admins, error: adminsError } = await supabase.rpc('push_admin_player_ids');
      if (adminsError) throw adminsError;
      for (const a of (alerts ?? []) as AdminAlert[]) {
        for (const admin of (admins ?? []) as { player_id: string }[]) {
          await sendPush(supabase, admin.player_id, a.headline, a.detail ?? '', '/admin', `a-${a.id}`);
          sentToAdmins += 1;
        }
      }
    }

    return json({ notifications: sentToPlayers, adminPushes: sentToAdmins });
  } catch (e) {
    console.error('dispatch-push failed', e);
    return json({ error: 'Something went wrong.' }, 500);
  }
});
