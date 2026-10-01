import webpush from 'npm:web-push';

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        single: () => Promise<{ data: { subscription?: webpush.PushSubscription } | null }>;
      };
    };
    delete: () => { eq: (column: string, value: string) => PromiseLike<unknown> };
  };
};

/**
 * Sends one Web Push to a player's device. Never throws: a push failure must
 * not break the operation that asked for it.
 *
 * `tag` lets the device show several notifications side by side. Without one the
 * service worker uses a single shared tag, so each push replaces the last, which
 * is the long-standing behaviour for the one-off pushes.
 *
 * A 404 or 410 from the push service means that device has unsubscribed or the
 * subscription expired; the row is removed so nobody keeps sending into it.
 */
export async function sendPush(
  supabase: SupabaseLike,
  playerId: string,
  title: string,
  body: string,
  url: string,
  tag?: string,
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('player_id', playerId)
      .single();

    if (!row?.subscription) return;

    webpush.setVapidDetails(
      `mailto:${Deno.env.get('VAPID_SUBJECT')}`,
      Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
      Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    );

    try {
      await webpush.sendNotification(row.subscription, JSON.stringify({ title, body, url, tag }));
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await supabase.from('push_subscriptions').delete().eq('player_id', playerId);
      }
    }
  } catch {
    // Never let a push failure break the main operation
  }
}
