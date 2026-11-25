import test from 'node:test';
import assert from 'node:assert/strict';

const data = new Map();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } }, configurable: true });
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
const { countVisit, mayCount, setCountsVisits } = await import('../src/services/visit.ts');

test('the wish not to be counted is respected', () => {
  assert.equal(mayCount({ webdriver: false, doNotTrack: null }), true);
  assert.equal(mayCount({ webdriver: false, doNotTrack: '1' }), false);
  assert.equal(mayCount({ webdriver: false, globalPrivacyControl: true }), false);
  assert.equal(mayCount({ webdriver: true }), false);
  setCountsVisits(false);
  assert.equal(mayCount({ webdriver: false }), false);
  setCountsVisits(true);
  assert.equal(data.size, 0);
});

test('a visit is sent once, without cookies or any content, and stores nothing', async () => {
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push([url, init]); return new Response(null, { status: 204 }); };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, webdriver: false }, configurable: true });
  countVisit(''); countVisit('https://api.example'); countVisit('https://api.example');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'https://api.example/api/v1/shares/visit');
  assert.deepEqual([sent[0][1].method, sent[0][1].credentials, sent[0][1].body, sent[0][1].headers], ['POST', 'omit', undefined, undefined]);
  assert.equal(data.size, 0);
});
