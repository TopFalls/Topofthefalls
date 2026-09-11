import test from 'node:test';
import assert from 'node:assert/strict';
import { activeChallengeCooldown, mayIssueChallenge } from '../src/lib/challengeCooldown.ts';
import { applyPostMatchCooldowns } from '../supabase/functions/_shared/postMatchCooldowns.ts';

const lossAt = Date.parse('2026-09-11T15:00:00Z');
const expires = lossAt + 7 * 24 * 60 * 60 * 1000;
const wait = { type: 'post_match', expires_at: new Date(expires).toISOString() };

test('a challenge loss blocks issuing throughout the full seven-day window', () => {
  for (const at of [lossAt, lossAt + 24 * 3600_000, expires - 1]) {
    const cooldown = activeChallengeCooldown([wait], at);
    assert.equal(mayIssueChallenge(true, true, false, cooldown), false);
  }
});

test('the wait ends at the expiry boundary, without an extra day', () => {
  assert.equal(mayIssueChallenge(true, true, false, activeChallengeCooldown([wait], expires)), true);
});

test('removing a wait after defence restores eligibility without reloading', () => {
  assert.equal(mayIssueChallenge(true, true, false, activeChallengeCooldown([], lossAt + 3600_000)), true);
});

test('overlapping waits remain blocked until the last applicable expiry', () => {
  const shorter = { type: 'wash', expires_at: new Date(lossAt + 3600_000).toISOString() };
  assert.equal(activeChallengeCooldown([shorter, wait], lossAt), wait);
  assert.equal(activeChallengeCooldown([wait, shorter], lossAt + 3600_000), wait);
  assert.equal(activeChallengeCooldown([shorter, wait], expires), null);
});

test('unknown or failed checks never expose issue-challenge actions', () => {
  assert.equal(mayIssueChallenge(true, false, false, null), false);
  assert.equal(mayIssueChallenge(true, true, true, null), false);
  assert.equal(mayIssueChallenge(false, true, false, null), false);
});

function fakeDatabase(initial = [], failure = null) {
  const rows = structuredClone(initial);
  return {
    rows,
    from(table) {
      if (table === 'league_settings') return { select: () => ({ single: async () => ({ data: { cooldown_hours: 24 }, error: failure === 'settings' ? new Error('settings unavailable') : null }) }) };
      assert.equal(table, 'cooldowns');
      return {
        async insert(values) {
          if (failure === 'insert') return { error: new Error('insert failed') };
          rows.push(...values.map((row) => ({ ...row, created_at: new Date(lossAt).toISOString() })));
          return { error: null };
        },
        delete() {
          const filters = [];
          const builder = {
            eq(key, value) { filters.push((row) => row[key] === value); return builder; },
            in(key, values) { filters.push((row) => values.includes(row[key])); return builder; },
            async lte(key, value) {
              if (failure === 'delete') return { error: new Error('delete failed') };
              filters.push((row) => row[key] <= value);
              for (let i = rows.length - 1; i >= 0; i--) {
                if (filters.every((predicate) => predicate(rows[i]))) rows.splice(i, 1);
              }
              return { error: null };
            },
          };
          return builder;
        },
      };
    },
  };
}

test('completed challenger loss writes an exact 168-hour wait', async () => {
  const db = fakeDatabase();
  await applyPostMatchCooldowns(db, 'challenger', 'defender', false, 'defender', new Date(lossAt).toISOString());
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].player_id, 'challenger');
  assert.equal(Date.parse(db.rows[0].expires_at), expires);
});

for (const defenderWins of [true, false]) {
  test(`completed defence clears prior post-loss/reentry waits when defender ${defenderWins ? 'wins' : 'loses'}`, async () => {
    const prior = ['post_match', 'reentry', 'wash'].map((type) => ({
      player_id: 'defender', type, created_at: new Date(lossAt - 3600_000).toISOString(), expires_at: new Date(expires).toISOString(),
    }));
    const db = fakeDatabase(prior);
    await applyPostMatchCooldowns(db, defenderWins ? 'challenger' : 'defender', defenderWins ? 'defender' : 'challenger', !defenderWins, 'defender', new Date(lossAt).toISOString());
    assert.deepEqual(db.rows.filter((row) => row.player_id === 'defender').map((row) => row.type), ['wash']);
    assert.equal(db.rows.find((row) => row.player_id === 'challenger').expires_at,
      new Date(lossAt + (defenderWins ? 168 : 24) * 3600_000).toISOString());
  });
}

test('defence does not clear a wait created after that completed match', async () => {
  const future = { player_id: 'defender', ...wait, created_at: new Date(lossAt + 1000).toISOString() };
  const db = fakeDatabase([future]);
  await applyPostMatchCooldowns(db, 'challenger', 'defender', false, 'defender', new Date(lossAt).toISOString());
  assert.ok(db.rows.some((row) => row.player_id === 'defender'));
});

test('cooldown storage failures are surfaced instead of silently omitting the wait', async () => {
  for (const failure of ['settings', 'insert', 'delete']) {
    await assert.rejects(() => applyPostMatchCooldowns(fakeDatabase([], failure), 'challenger', 'defender', false, 'defender', new Date(lossAt).toISOString()));
  }
});
