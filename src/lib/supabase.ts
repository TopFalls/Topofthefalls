import { createClient } from '@supabase/supabase-js';

// This league runs on its own Supabase project. There is deliberately NO
// hardcoded project fallback here: an upstream clone of this codebase shipped
// one, which meant a deploy with unset/mis-scoped env vars silently connected
// to a DIFFERENT league's production database. Failing loudly is correct —
// never re-add a literal project URL or anon key to this file.
const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!envUrl || !envKey) {
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. Set both in the Vercel project ' +
      '(Production, Preview and Development scopes) and in your local .env, pointing at THIS ' +
      "league's Supabase project. There is no built-in fallback by design.",
  );
}

export const SUPABASE_URL = envUrl;
const key = envKey;

// Base for calling edge functions; use this instead of reading
// import.meta.env.VITE_SUPABASE_URL directly so the fallback applies everywhere.
export const functionsUrl = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;

export const supabase = createClient(SUPABASE_URL, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
