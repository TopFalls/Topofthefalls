export type CooldownWindow = { type: string; expires_at: string };

/** Only the issuing player's waits belong here; an opponent's wait is irrelevant. */
export function activeChallengeCooldown(rows: CooldownWindow[], now = Date.now()): CooldownWindow | null {
  return rows.filter((row) => Date.parse(row.expires_at) > now)
    .sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at))[0] ?? null;
}

export function mayIssueChallenge(hasPlayer: boolean, ready: boolean, failed: boolean, cooldown: CooldownWindow | null) {
  return hasPlayer && ready && !failed && !cooldown;
}
