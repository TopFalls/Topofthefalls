/**
 * Phone numbers and PINs as typed by a person. The same rules are applied again
 * on the server (supabase/functions/_shared/phoneAuth.ts); this copy is only so
 * the form can say what is wrong before anything is sent.
 */

/** A US phone number as ten digits, or null. Accepts spaces, dashes, dots, brackets and a leading 1 or +1. */
export function normalizePhone(input: string): string | null {
  if (input.length > 40) return null;
  let digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return /^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits) ? digits : null;
}

/** (406) 555-0123, built up as the person types. */
export function formatPhoneAsTyped(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('1')) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizePin(input: string): string | null {
  const pin = input.trim();
  return /^[0-9]{4}$/.test(pin) ? pin : null;
}

/** Keep only digits, at most four, for a PIN box. */
export function pinAsTyped(input: string): string {
  return input.replace(/\D/g, '').slice(0, 4);
}
