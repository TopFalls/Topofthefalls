import { supabase, functionsUrl } from './supabase';

export class EdgeFunctionError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'EdgeFunctionError';
    this.status = status;
  }
}

/**
 * Call a Supabase edge function as the signed-in user.
 *
 * Centralizes the session lookup, headers, and error decoding that was
 * previously copy-pasted at every call site. Throws EdgeFunctionError with a
 * user-presentable message; callers catch and surface `error.message`.
 */
export async function callEdgeFunction<T = Record<string, unknown>>(
  name: string,
  body: unknown,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new EdgeFunctionError('Session expired — please log in again.');

  let res: Response;
  try {
    res = await fetch(functionsUrl(name), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new EdgeFunctionError('Network error — please try again.');
  }

  const json: unknown = await res.json().catch(() => ({}));
  const serverError =
    json && typeof json === 'object' && 'error' in json
      ? (json as { error?: unknown }).error
      : undefined;
  if (!res.ok || serverError) {
    const message = typeof serverError === 'string' && serverError.length > 0
      ? serverError
      : `Request failed (${res.status}).`;
    throw new EdgeFunctionError(message, res.status);
  }
  return json as T;
}

/** Normalize an unknown thrown value to a user-presentable message. */
export function edgeErrorMessage(err: unknown, fallback = 'Something went wrong — please try again.'): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
