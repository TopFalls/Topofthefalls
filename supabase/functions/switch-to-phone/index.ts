// A member who is already signed in switches themselves over to phone + PIN.
// Being signed in is the proof of who they are, so no admin step is needed.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';
import { hashSecret, normalizePhone, normalizePin } from '../_shared/phoneAuth.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const phone = normalizePhone(body?.phone);
    const pin = normalizePin(body?.pin);
    if (!phone || !pin) return json({ error: 'Enter a 10-digit phone number and choose a 4-digit PIN.' }, 400);

    const { data: player, error: playerErr } = await admin
      .from('players')
      .select('id, full_name')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (playerErr) throw playerErr;
    if (!player) return json({ error: 'Claim your name on the list first.' }, 409);

    const { data: existing, error: existingErr } = await admin
      .from('login_credentials')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return json({ error: 'You have already switched to phone sign-in.' }, 409);

    const { error: insertErr } = await admin.from('login_credentials').insert({
      user_id: user.id,
      player_id: player.id,
      secret_hash: await hashSecret(phone, pin),
      phone_last4: phone.slice(-4),
    });
    if (insertErr) {
      // 23505 = that player already has a sign-in. Should not happen once
      // the checks above passed, but never leak the database's wording.
      if ((insertErr as { code?: string }).code === '23505') {
        return json({ error: 'That player already has a phone sign-in. Ask a league admin.' }, 409);
      }
      throw insertErr;
    }

    await admin.from('audit_events').insert({
      actor_profile_id: user.id,
      action: 'phone_login_switched',
      target_type: 'player',
      target_id: player.id,
      detail: { player_name: player.full_name },
    });

    return json({ success: true });
  } catch (e) {
    console.error('switch-to-phone failed', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
