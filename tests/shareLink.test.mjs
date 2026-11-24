import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchShare, parseSharedRoute, shareProblem } from '../src/services/shareLink.ts';

const id = '3f2c1a90-1111-4222-8333-944455556666';
const key = 'A'.repeat(42) + '_';

test('reads a normal share link', () => {
  assert.deepEqual(parseSharedRoute(`shared/${id}?k=${key}`), { id, key });
});

test('repairs links that a messenger or mail app changed', () => {
  assert.deepEqual(parseSharedRoute(`shared/${id}%3Fk%3D${key}`), { id, key });
  assert.deepEqual(parseSharedRoute(`shared/${id}/?k=${key}`), { id, key });
  assert.deepEqual(parseSharedRoute(`shared/​${id.toUpperCase()}?k=${key}).`), { id, key });
  assert.deepEqual(parseSharedRoute(`shared/${id}?utm_source=chat&k=${key}`), { id, key });
});

test('reports which half of a broken link is missing', () => {
  assert.deepEqual(parseSharedRoute(`shared/${id}`), { id, key: '' });
  assert.deepEqual(parseSharedRoute(`shared/${id.slice(0, 20)}?k=${key}`), { id: '', key });
  assert.deepEqual(parseSharedRoute('shared/%E0%A4%A?k=%'), { id: '', key: '' });
});

test('a server problem is not reported as a missing project', () => {
  assert.match(shareProblem(410).message, /expired|deleted/);
  assert.equal(shareProblem(410).retry, false);
  for (const status of [0, 429, 500, 503]) {
    assert.equal(shareProblem(status).retry, true);
    assert.doesNotMatch(shareProblem(status).message, /found|expired/);
  }
});

test('a short outage is retried before the reader sees an error', async () => {
  const replies = [503, 'network', 200];
  let calls = 0;
  const fetcher = async () => { const next = replies[calls++]; if (next === 'network') throw new TypeError('Load failed'); return new Response('{}', { status: next }); };
  assert.equal((await fetchShare('https://share.example', fetcher, 0)).status, 200);
  assert.equal(calls, 3);
});

test('a final answer is not retried', async () => {
  let calls = 0;
  assert.equal((await fetchShare('https://share.example', async () => { calls++; return new Response('{}', { status: 410 }); }, 0)).status, 410);
  assert.equal(calls, 1);
});

test('a lasting network failure is returned as status 0', async () => {
  assert.equal((await fetchShare('https://share.example', async () => { throw new TypeError('Load failed'); }, 0)).status, 0);
});
