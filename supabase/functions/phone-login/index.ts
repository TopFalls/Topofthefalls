// tof-guard: public
// Sign-in happens BEFORE there is a login, so this function cannot require one;
// it is deployed with verify_jwt = false. What protects it instead:
//   - every try is counted per address and per player BEFORE the secret is
//     checked, and locks for longer each time (login_begin_attempt);
//   - a wrong player, wrong phone and wrong PIN all get the same answer, and the
//     work done is the same, so nothing here says who has a sign-in;
//   - the credential table is unreachable from a browser, so there is no way to
//     guess against the hash without going through this counter.
// The session is minted on the server from an admin link that is never emailed.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';
import {
  LOCKED_OUT, SIGN_IN_FAILED, UUID_RE, callerAddress, normalizePhone, normalizePin, playerAttemptKey, shortHash, verifySecret,
} from '../_shared/phoneAuth.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const playerId = typeof body?.player_id === 'string' ? body.player_id : '';
    const phone = normalizePhone(body?.phone);
    const pin = normalizePin(body?.pin);
    if (!UUID_RE.test(playerId) || !phone || !pin) {
      return json({ error: 'Pick your name, then enter a 10-digit phone number and your 4-digit PIN.' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Count this try against the address first, then the player.
    const ipKey = `i:${await shortHash(callerAddress(req))}`;
    const { data: ipOk, error: ipErr } = await admin.rpc('login_begin_attempt', {
      p_key: ipKey, p_max: 40, p_window: '10 minutes', p_lock: '10 minutes',
    });
    if (ipErr) throw ipErr;
    if (ipOk !== true) return json({ error: LOCKED_OUT }, 429);

    const attemptKey = playerAttemptKey(playerId);
    const { data: playerOk, error: playerErr } = await admin.rpc('login_begin_attempt', {
      p_key: attemptKey, p_max: 5, p_window: '15 minutes', p_lock: '15 minutes',
    });
    if (playerErr) throw playerErr;
    if (playerOk !== true) return json({ error: LOCKED_OUT }, 429);

    const { data: credential, error: credErr } = await admin
      .from('login_credentials')
      .select('user_id, secret_hash, player:players(removed_at)')
      .eq('player_id', playerId)
      .maybeSingle();
    if (credErr) throw credErr;

    // Runs the same hash whether or not this player has a sign-in.
    const matches = await verifySecret(phone, pin, credential?.secret_hash);
    const removed = !!(credential?.player as { removed_at: string | null } | null)?.removed_at;
    if (!credential || !matches || removed) return json({ error: SIGN_IN_FAILED }, 401);

    await admin.rpc('login_clear_attempts', { p_key: attemptKey });

    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(credential.user_id);
    if (userErr || !userRes?.user?.email) throw userErr ?? new Error('account has no identifier');

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: userRes.user.email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkErr || !tokenHash) throw linkErr ?? new Error('no token from generateLink');

    // A separate client with no stored session redeems the one-time token.
    const redeemer = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    let session = null;
    for (const type of ['magiclink', 'email'] as const) {
      const { data, error } = await redeemer.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error && data?.session) { session = data.session; break; }
    }
    if (!session) throw new Error('could not redeem the sign-in token');

    await admin.from('login_credentials').update({ last_login_at: new Date().toISOString() }).eq('user_id', credential.user_id);

    return json({ session: { access_token: session.access_token, refresh_token: session.refresh_token } });
  } catch (e) {
    console.error('phone-login failed', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
