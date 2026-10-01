/**
 * The public half of the league's Web Push key pair (VAPID).
 *
 * It is public by design: browsers use it to check that a push really came from
 * this app, and it is shipped to every visitor either way. The matching PRIVATE
 * key lives only in the Supabase edge-function secrets (VAPID_PRIVATE_KEY) and
 * must never appear in this repository.
 *
 * A `VITE_VAPID_PUBLIC_KEY` set in Vercel wins over this value, so the key can
 * be rotated there. When rotating, change the Supabase secrets to the new pair
 * too, or every existing subscription will stop receiving pushes.
 */
export const DEFAULT_VAPID_PUBLIC_KEY =
  'BCiOTBCXrAFRSBB32gWJOKQtOY0KzjGYq0WLTDKgw8EvmRYLIEb0qMoK356_MHNy0zjpG8m6gdMwmBPm1yQ0GFo';

export const VAPID_PUBLIC_KEY: string =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || DEFAULT_VAPID_PUBLIC_KEY;
