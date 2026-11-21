// Shared helpers for Nile Therapy Edge Functions.
// The admin client uses the SECRET key (bypasses RLS). It only exists on Supabase's servers,
// never in the browser. Every function checks who is calling before using it.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

// Websites allowed to call these functions (CORS).
const ALLOWED_ORIGINS = ['https://odostore11-creator.github.io', 'http://localhost:5500'];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function secretKey(): string {
  try {
    const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
    if (k) return k;
  } catch { /* fall back to the legacy key */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

export const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type Profile = {
  id: string; username: string; role: 'admin' | 'doctor'; full_name: string; title: string;
  specialty: string; phone: string; area: string; bio: string; active: boolean; created_at: string;
};

/** Checks the caller's login token and that they are an active founder. */
export async function requireFounder(req: Request): Promise<Profile> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || token.startsWith('sb_')) throw new HttpError(401, 'Please log in');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Please log in again');
  const { data: me } = await admin.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  if (!me || !me.active || me.role !== 'admin') throw new HttpError(403, 'Only founders can do this');
  return me as Profile;
}

/** Wraps a handler: CORS, POST-only, JSON in/out, friendly errors. */
export function serve(handler: (req: Request, body: Record<string, unknown>) => Promise<unknown>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
    let status = 200, out: unknown;
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
      const body = await req.json().catch(() => { throw new HttpError(400, 'Send JSON'); });
      out = await handler(req, body ?? {});
    } catch (e) {
      status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      out = { error: status === 500 ? 'Server error' : (e as Error).message };
    }
    return new Response(JSON.stringify(out), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
  });
}

export const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function randomPassword(): string {
  const b = new Uint8Array(9); // 12 characters
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
}
