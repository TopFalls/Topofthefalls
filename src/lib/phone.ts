// Phone numbers for sign-in. Supabase wants E.164 (+14065551234); players type
// whatever their thumbs produce. The league is in Great Falls, Montana, so a
// bare 10-digit number is a US number.

/** Returns E.164 for a US number, or null if it cannot be one. */
export function toE164(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    // Only US/Canada (+1) is accepted for now: the SMS provider is set up for it.
    return /^1\d{10}$/.test(digits) && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits.slice(1))
      ? `+${digits}`
      : null;
  }
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  // NANP: area code and exchange cannot start with 0 or 1.
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? `+1${national}` : null;
}

/** +14065551234 -> (406) 555-1234, for showing back to the player. */
export function formatPhone(e164: string | null | undefined): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? '');
}
