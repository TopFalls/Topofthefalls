// tof-guard: public
// A signed-out member asking to be let in has no login yet, so this is deployed
// with verify_jwt = false. It cannot let anyone in by itself: it only leaves a
// request that Carl or Mike must approve. It is limited per address, always
// answers the same way, and writes nothing a browser can read back.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';
import { LOCKED_OUT, UUID_RE, callerAddress, hashSecret, normalizePhone, normalizePin, shortHash } from '../_shared/phoneAuth.ts';

const MAX_WAITING_PER_PLAYER = 3;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const playerId = typeof body?.player_id === 'string' ? body.player_id : '';
    const phone = normalizePhone(body?.phone);
    const pin = normalizePin(body?.pin);
    if (!UUID_RE.test(playerId)) return json({ error: 'Pick your name from the list.' }, 400);
    if (!phone || !pin) return json({ error: 'Enter a 10-digit phone number and choose a 4-digit PIN.' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: allowed, error: limitErr } = await admin.rpc('login_begin_attempt', {
      p_key: `s:${await shortHash(callerAddress(req))}`, p_max: 8, p_window: '1 hour', p_lock: '1 hour',
    });
    if (limitErr) throw limitErr;
    if (allowed !== true) return json({ error: LOCKED_OUT }, 429);

    const { data: player, error: playerErr } = await admin
      .from('players')
      .select('id, full_name, is_active, removed_at')
      .eq('id', playerId)
      .maybeSingle();
    if (playerErr) throw playerErr;
    if (!player || player.removed_at) return json({ error: 'Pick your name from the list.' }, 400);

    const { count: waiting, error: countErr } = await admin
      .from('login_requests')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('status', 'pending');
    if (countErr) throw countErr;
    if ((waiting ?? 0) >= MAX_WAITING_PER_PLAYER) {
      return json({ error: 'There are already requests waiting for this name. Ask a league admin to look at them.' }, 409);
    }

    const { error: insertErr } = await admin.from('login_requests').insert({
      player_id: playerId,
      phone,
      phone_last4: phone.slice(-4),
      secret_hash: await hashSecret(phone, pin),
    });
    if (insertErr) throw insertErr;

    // One open alert per name, however many requests are waiting.
    const { data: openAlert } = await admin
      .from('admin_alerts')
      .select('id')
      .eq('alert_type', 'login_request')
      .eq('player_id', playerId)
      .is('acknowledged_at', null)
      .limit(1)
      .maybeSingle();
    if (!openAlert) {
      await admin.from('admin_alerts').insert({
        alert_type: 'login_request',
        headline: `${player.full_name} asked to sign in`,
        detail: 'Open Admin, then Sign-ins, to approve or turn it down.',
        player_id: playerId,
      });
    }

    return json({ ok: true });
  } catch (e) {
    console.error('phone-request failed', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
