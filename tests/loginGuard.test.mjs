import test from 'node:test';
import assert from 'node:assert/strict';

const data = new Map();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } }, configurable: true });
const { mailSent, rightPassword, waitFor, wrongPassword } = await import('../src/services/loginGuard.ts');
const start = Date.now();

test('four wrong passwords are free, then the waiting time doubles up to 15 minutes', () => {
  data.clear();
  const waits = [];
  let now = start;
  for (let i = 0; i < 12; i++) { wrongPassword(now); waits.push(waitFor('password', now)); now += waits.at(-1) * 1000 + 1000; }
  assert.deepEqual(waits, [0, 0, 0, 0, 30, 60, 120, 240, 480, 900, 900, 900]);
});

test('the right password or an hour without tries clears it', () => {
  data.clear();
  for (let i = 0; i < 6; i++) wrongPassword(start);
  assert.equal(waitFor('password', start), 60);
  rightPassword();
  assert.equal(waitFor('password', start), 0);
  for (let i = 0; i < 6; i++) wrongPassword(start);
  wrongPassword(start + 2 * 3600_000);
  assert.equal(waitFor('password', start + 2 * 3600_000), 0);
});

test('one email of a kind per minute, and broken storage locks nobody out', () => {
  data.clear();
  mailSent('reset', start);
  assert.deepEqual([waitFor('reset', start), waitFor('link', start), waitFor('reset', start + 61_000)], [60, 0, 0]);
  data.set('localdeck-login-guard', '{broken');
  assert.equal(waitFor('password', start), 0);
  data.set('localdeck-login-guard', JSON.stringify({ password: { wrong: 9, last: start, until: start + 10 ** 10 } }));
  assert.equal(waitFor('password', start), 0);
});
