import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  // Without this the app dies during module evaluation and the user sees only
  // a black page — render a readable explanation before throwing.
  const root = typeof document !== 'undefined' ? document.getElementById('root') : null;
  if (root) {
    root.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#0D0D0D;color:#E8E2D6;font-family:system-ui,sans-serif;text-align:center;">' +
      '<div><h1 style="font-size:20px;margin:0 0 8px;">Configuration error</h1>' +
      '<p style="color:#9CA3AF;font-size:14px;max-width:460px;margin:0;line-height:1.5;">' +
      'This deployment is missing its Supabase settings (<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>). ' +
      'In Vercel: Project Settings &rarr; Environment Variables &rarr; add both for this environment (Production, Preview, or Development), then redeploy.' +
      '</p></div></div>';
  }
  throw new Error('[TOC] Missing Supabase env vars — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local');
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
