import { supabase, functionsUrl } from './supabase';

/**
 * Calls the two sign-in functions that run before there is a login. Neither
 * carries a session, and neither keeps the phone number or PIN anywhere in the
 * browser: they go straight into the request and are forgotten.
 */
async function post<T>(name: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(functionsUrl(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Network error — please try again.');
  }
  const json: unknown = await res.json().catch(() => ({}));
  const message = json && typeof json === 'object' && 'error' in json ? (json as { error?: unknown }).error : undefined;
  if (!res.ok || message) {
    throw new Error(typeof message === 'string' && message ? message : `Request failed (${res.status}).`);
  }
  return json as T;
}

export async function signInWithPhone(playerId: string, phone: string, pin: string): Promise<void> {
  const { session } = await post<{ session: { access_token: string; refresh_token: string } }>('phone-login', { player_id: playerId, phone, pin });
  const { error } = await supabase.auth.setSession(session);
  if (error) throw new Error('Could not finish signing you in. Please try again.');
}

export async function requestToJoin(playerId: string, phone: string, pin: string): Promise<void> {
  await post('phone-request', { player_id: playerId, phone, pin });
}
