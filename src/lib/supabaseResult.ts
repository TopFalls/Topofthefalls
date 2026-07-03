import type { PostgrestError } from '@supabase/supabase-js';

type PostgrestResult<T> = { data: T | null; error: PostgrestError | null };

/**
 * Unwrap a Supabase list response, throwing on failure.
 *
 * The `const { data } = await supabase…; return data ?? []` pattern renders a
 * fetch failure as a convincing empty list. Throwing instead lets React Query
 * keep the last good data, retry, and expose `isError` to the page.
 */
export function unwrapList<T>(res: PostgrestResult<T[]>): T[] {
  if (res.error) throw res.error;
  return res.data ?? [];
}

/** Unwrap a single-row Supabase response, throwing on failure. */
export function unwrap<T>(res: PostgrestResult<T>): T | null {
  if (res.error) throw res.error;
  return res.data;
}
