/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import webpush from 'npm:web-push';

// One place that knows how to reach a phone. Every edge function that pushes
// goes through here, so "which devices does this person have" is answered once.
//
// Devices live in two tables: push_devices (one row per account per device,
// includes visitors) and push_subscriptions (the older one-row-per-player
// table). Both are read so nothing that worked before stops working.

type Device = { endpoint: string; subscription: any; deviceId?: string };

function configureVapid() {
  webpush.setVapidDetails(
    `mailto:${Deno.env.get('VAPID_SUBJECT')}`,
    Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  );
}

async function deliver(supabase: any, devices: Device[], payload: Record<string, string>) {
  // The same phone can appear in both tables; it must only buzz once.
  const seen = new Set<string>();
  const unique = devices.filter((d) => d.endpoint && !seen.has(d.endpoint) && seen.add(d.endpoint));
  if (unique.length === 0) return;

  configureVapid();
  const body = JSON.stringify(payload);
  await Promise.allSettled(unique.map(async (d) => {
    try {
      await webpush.sendNotification(d.subscription, body);
    } catch (err: any) {
      // 404/410 mean the phone uninstalled the app or revoked permission.
      // Forget it so it is not tried forever.
      if ((err?.statusCode === 404 || err?.statusCode === 410) && d.deviceId) {
        await supabase.from('push_devices').delete().eq('id', d.deviceId);
      }
    }
  }));
}

function devicesFromRows(rows: any[] | null | undefined): Device[] {
  return (rows ?? []).map((r) => ({ endpoint: r.endpoint, subscription: r.subscription, deviceId: r.id }));
}

/** Push to one player: every device on their account, plus the legacy row. */
export async function sendPush(
  supabase: any,
  playerId: string,
  title: string,
  body: string,
  url: string,
): Promise<void> {
  try {
    const [{ data: player }, { data: legacy }] = await Promise.all([
      supabase.from('players').select('profile_id').eq('id', playerId).maybeSingle(),
      supabase.from('push_subscriptions').select('subscription').eq('player_id', playerId).maybeSingle(),
    ]);
    const devices: Device[] = [];
    if (player?.profile_id) {
      const { data: rows } = await supabase
        .from('push_devices').select('id, endpoint, subscription').eq('profile_id', player.profile_id);
      devices.push(...devicesFromRows(rows));
    }
    if (legacy?.subscription) {
      devices.push({ endpoint: legacy.subscription.endpoint, subscription: legacy.subscription });
    }
    await deliver(supabase, devices, { title, body, url });
  } catch {
    // Never let a push failure break the main operation
  }
}

/**
 * Push to everyone who follows any of `playerIds`. Accounts belonging to the
 * players in `excludePlayerIds` are skipped: the people in the match already
 * get their own, more specific, notification.
 */
export async function notifyFollowers(
  supabase: any,
  playerIds: string[],
  title: string,
  body: string,
  url: string,
  excludePlayerIds: string[] = [],
): Promise<void> {
  try {
    const { data: follows } = await supabase
      .from('player_follows').select('profile_id').in('player_id', playerIds);
    const profileIds = new Set<string>((follows ?? []).map((f: any) => f.profile_id));
    if (profileIds.size === 0) return;

    if (excludePlayerIds.length > 0) {
      const { data: excluded } = await supabase
        .from('players').select('profile_id').in('id', excludePlayerIds);
      for (const p of excluded ?? []) if (p.profile_id) profileIds.delete(p.profile_id);
    }
    if (profileIds.size === 0) return;

    const { data: rows } = await supabase
      .from('push_devices').select('id, endpoint, subscription').in('profile_id', [...profileIds]);
    await deliver(supabase, devicesFromRows(rows), { title, body, url });
  } catch {
    // Followers are a courtesy; never fail the result because of them.
  }
}
