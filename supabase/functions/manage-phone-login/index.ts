// Admin side of phone sign-in: see who is waiting, let them in, turn them down,
// or clear a lockout. Admin and super_admin only.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';
import { UUID_RE, internalEmailFor, playerAttemptKey } from '../_shared/phoneAuth.ts';

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

    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!me || !['admin', 'super_admin'].includes(me.role)) return json({ error: 'Admins only.' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === 'list') {
      const { data: requests, error } = await admin
        .from('login_requests')
        .select('id, player_id, phone, created_at, player:players(full_name, profile_id)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;
      const playerIds = [...new Set((requests ?? []).map((r) => r.player_id))];
      const { data: creds } = playerIds.length
        ? await admin.from('login_credentials').select('player_id').in('player_id', playerIds)
        : { data: [] };
      const switched = new Set((creds ?? []).map((c) => c.player_id));
      const profileIds = (requests ?? []).map((r) => (r.player as { profile_id: string | null } | null)?.profile_id).filter(Boolean) as string[];
      const { data: roles } = profileIds.length
        ? await admin.from('profiles').select('id, role').in('id', profileIds)
        : { data: [] };
      const adminIds = new Set((roles ?? []).filter((p) => p.role !== 'player').map((p) => p.id));
      return json({
        requests: (requests ?? []).map((r) => {
          const p = r.player as { full_name: string; profile_id: string | null } | null;
          return {
            id: r.id,
            player_id: r.player_id,
            player_name: p?.full_name ?? 'Unknown',
            phone: r.phone,
            created_at: r.created_at,
            // 'new' = no account yet; 'replace' = this name already signs in and the request would swap the phone/PIN.
            kind: switched.has(r.player_id) ? 'replace' : p?.profile_id ? 'switch' : 'new',
            is_admin_account: !!p?.profile_id && adminIds.has(p.profile_id),
          };
        }),
      });
    }

    if (action === 'unlock') {
      if (typeof body?.player_id !== 'string' || !UUID_RE.test(body.player_id)) return json({ error: 'player_id required' }, 400);
      const { data: player } = await admin.from('players').select('full_name').eq('id', body.player_id).maybeSingle();
      if (!player) return json({ error: 'Player not found.' }, 404);
      await admin.rpc('login_clear_attempts', { p_key: playerAttemptKey(body.player_id) });
      await admin.from('audit_events').insert({
        actor_profile_id: user.id, action: 'phone_login_unlocked', target_type: 'player', target_id: body.player_id,
        detail: { player_name: player.full_name },
      });
      return json({ success: true });
    }

    if (action === 'approve' || action === 'reject') {
      if (typeof body?.request_id !== 'string' || !UUID_RE.test(body.request_id)) return json({ error: 'request_id required' }, 400);

      const { data: request, error: reqErr } = await admin
        .from('login_requests')
        .select('id, player_id, secret_hash, phone_last4, status')
        .eq('id', body.request_id)
        .maybeSingle();
      if (reqErr) throw reqErr;
      if (!request || request.status !== 'pending') return json({ error: 'That request is no longer waiting.' }, 409);

      const { data: player, error: playerErr } = await admin
        .from('players')
        .select('id, full_name, profile_id, removed_at')
        .eq('id', request.player_id)
        .maybeSingle();
      if (playerErr) throw playerErr;
      if (!player) return json({ error: 'Player not found.' }, 404);

      const decidedAt = new Date().toISOString();
      const closeRequests = async (status: 'approved' | 'rejected') => {
        // The deciding row gets the real status; any others waiting for the same
        // name are settled by the same decision, and every phone number is wiped.
        await admin.from('login_requests')
          .update({ status, phone: null, decided_at: decidedAt, decided_by: user.id })
          .eq('id', request.id);
        await admin.from('login_requests')
          .update({ status: 'rejected', phone: null, decided_at: decidedAt, decided_by: user.id })
          .eq('player_id', request.player_id)
          .eq('status', 'pending');
        await admin.from('admin_alerts')
          .update({ acknowledged_at: decidedAt, acknowledged_by: user.id })
          .eq('alert_type', 'login_request')
          .eq('player_id', request.player_id)
          .is('acknowledged_at', null);
      };

      if (action === 'reject') {
        await closeRequests('rejected');
        await admin.from('audit_events').insert({
          actor_profile_id: user.id, action: 'login_request_rejected', target_type: 'player', target_id: player.id,
          detail: { player_name: player.full_name },
        });
        return json({ success: true });
      }

      if (player.removed_at) return json({ error: 'That player has been removed from the league.' }, 409);
      if (player.profile_id === user.id) return json({ error: 'Ask another admin to approve your own sign-in.' }, 403);

      // The name already has an account: keep it, so history and any admin role
      // carry over. Otherwise make a new account with a placeholder identifier.
      let userId = player.profile_id as string | null;
      let createdUserId: string | null = null;
      if (!userId) {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: internalEmailFor(crypto.randomUUID()),
          email_confirm: true,
        });
        if (createErr || !created?.user) throw createErr ?? new Error('could not create the account');
        createdUserId = created.user.id;
        const { data: linked, error: linkErr } = await admin
          .from('players')
          .update({ profile_id: createdUserId })
          .eq('id', player.id)
          .is('profile_id', null)
          .select('id');
        if (linkErr || !linked?.length) {
          await admin.auth.admin.deleteUser(createdUserId);
          if (linkErr) throw linkErr;
          return json({ error: 'That name was claimed a moment ago. Refresh and look again.' }, 409);
        }
        await admin.from('profiles').update({ display_name: player.full_name }).eq('id', createdUserId);
        userId = createdUserId;
      }

      const { error: credErr } = await admin.from('login_credentials').upsert({
        user_id: userId,
        player_id: player.id,
        secret_hash: request.secret_hash,
        phone_last4: request.phone_last4,
        updated_at: decidedAt,
      }, { onConflict: 'user_id' });
      if (credErr) {
        if (createdUserId) {
          await admin.from('players').update({ profile_id: null }).eq('id', player.id).eq('profile_id', createdUserId);
          await admin.auth.admin.deleteUser(createdUserId);
        }
        throw credErr;
      }

      await admin.rpc('login_clear_attempts', { p_key: playerAttemptKey(player.id) });
      await closeRequests('approved');
      await admin.from('audit_events').insert({
        actor_profile_id: user.id, action: 'login_request_approved', target_type: 'player', target_id: player.id,
        detail: { player_name: player.full_name, new_account: !!createdUserId },
      });
      return json({ success: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error('manage-phone-login failed', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
