import test from 'node:test';
import assert from 'node:assert/strict';
import { toE164, formatPhone } from '../src/lib/phone.ts';

test('a typed US number becomes E.164', () => {
  for (const typed of ['4065551234', '(406) 555-1234', '406-555-1234', '1 406 555 1234', '+1 (406) 555-1234']) {
    assert.equal(toE164(typed), '+14065551234', typed);
  }
});

test('numbers that cannot be dialed are refused', () => {
  for (const typed of ['', 'abc', '555-1234', '4065551', '1065551234', '4061551234', '+44 20 7946 0958', '+1406555123']) {
    assert.equal(toE164(typed), null, typed);
  }
});

test('a number is shown back the way people write it', () => {
  assert.equal(formatPhone('+14065551234'), '(406) 555-1234');
  assert.equal(formatPhone(null), '');
});
