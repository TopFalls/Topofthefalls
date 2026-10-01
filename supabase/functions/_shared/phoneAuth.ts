// Shared pieces of phone + PIN sign-in. Pure functions only (no Deno globals),
// so the same file is exercised by the node tests in test/phone-login.test.mjs.

/**
 * Supabase Auth wants an identifier on every account. Accounts created for phone
 * sign-in get this placeholder. `.invalid` is reserved (RFC 2606) and can never
 * be delivered to, and nothing in the app ever sends to it or shows it.
 */
export const INTERNAL_EMAIL_DOMAIN = 'phone-login.invalid';

export function internalEmailFor(id: string): string {
  return `u-${id}@${INTERNAL_EMAIL_DOMAIN}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The counter that guards one player's sign-in. */
export const playerAttemptKey = (playerId: string) => `p:${playerId.toLowerCase()}`;

/**
 * A US phone number as ten digits, or null. Spaces, dashes, dots, brackets and a
 * leading +1 or 1 are all accepted so people can type it the way they do on
 * their own phone.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  let digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (!/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits)) return null;
  return digits;
}

export function normalizePin(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const pin = input.trim();
  return /^[0-9]{4}$/.test(pin) ? pin : null;
}

export const HASH_ITERATIONS = 600_000;

const enc = new TextEncoder();
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

async function derive(phone: string, pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`${phone}:${pin}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** `pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>`; the cost travels with the hash. */
export async function hashSecret(phone: string, pin: string, iterations = HASH_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(phone, pin, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toHex(salt)}$${toHex(hash)}`;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Checks a phone + PIN against a stored hash. When there is no stored hash (the
 * name does not exist) it still does the same amount of work, so the time taken
 * does not tell a stranger which names are real.
 */
export async function verifySecret(phone: string, pin: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? '').split('$');
  const valid = parts.length === 4 && parts[0] === 'pbkdf2-sha256' && /^[0-9a-f]+$/.test(parts[2]) && /^[0-9a-f]+$/.test(parts[3]);
  const iterations = valid ? Number(parts[1]) : HASH_ITERATIONS;
  const salt = valid ? fromHex(parts[2]) : new Uint8Array(16);
  const expected = valid ? fromHex(parts[3]) : new Uint8Array(32);
  const actual = await derive(phone, pin, salt, Number.isFinite(iterations) && iterations > 0 ? iterations : HASH_ITERATIONS);
  return constantTimeEqual(actual, expected) && valid;
}

/** A short, one-way label for an address, so the lockout table never holds a raw IP. */
export async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return toHex(new Uint8Array(digest)).slice(0, 24);
}

/** The caller's address as the platform reports it. */
export function callerAddress(req: Request): string {
  // cf-connecting-ip is set by the platform's edge in front of the function; a
  // caller cannot choose it. x-forwarded-for is only the fallback.
  const edge = req.headers.get('cf-connecting-ip')?.trim();
  if (edge) return edge;
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim() || 'unknown';
}

/** The same message for every way a sign-in can fail. */
export const SIGN_IN_FAILED =
  "That name, phone number and PIN don't match. If you just asked to join, a league admin still needs to approve you.";

export const LOCKED_OUT =
  'Too many tries. Wait a while and try again, or ask a league admin to unlock you.';
