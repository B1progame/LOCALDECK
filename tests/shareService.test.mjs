import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadShare, getAccount, PART_BYTES, SINGLE_BYTES, uploadShare } from '../src/services/shareService.ts';

const real = globalThis.fetch;
function server(handler) { const calls = []; globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), method: init.method ?? 'GET', size: init.body?.size, headers: init.headers }); return handler(String(url), init, calls.length); }; return calls; }
test.afterEach(() => { globalThis.fetch = real; });

test('a small project is sent in one request', async () => {
  const calls = server(() => Response.json({ id: 'a', expiresAt: 'x' }, { status: 201 }));
  await uploadShare('https://api', 't', new Blob([new Uint8Array(1000)]));
  assert.deepEqual(calls.map(call => [call.method, call.size, call.headers['x-share-parts']]), [['POST', 1000, undefined]]);
});

test('a large project is sent in parts, retried after an outage, and reports progress', async () => {
  let failures = 1;
  const calls = server((url, init) => init.method === 'PUT' && failures-- > 0 ? new Response('', { status: 503 }) : Response.json({ id: 'a', expiresAt: 'x' }));
  const progress = [];
  await uploadShare('https://api', 't', new Blob([new Uint8Array(SINGLE_BYTES + 10)]), value => progress.push(value), 0);
  assert.deepEqual(calls.map(call => [call.method, call.size]), [['POST', PART_BYTES], ['PUT', SINGLE_BYTES + 10 - PART_BYTES], ['PUT', SINGLE_BYTES + 10 - PART_BYTES]]);
  assert.equal(calls[0].headers['x-share-size'], String(SINGLE_BYTES + 10));
  assert.deepEqual(progress, [.5, 1]);
});

test('a failed large upload is cleaned up and explained', async () => {
  const calls = server((url, init) => init.method === 'PUT' ? Response.json({ error: 'blocked' }, { status: 403 }) : Response.json({ id: 'a', expiresAt: 'x' }));
  await assert.rejects(uploadShare('https://api', 't', new Blob([new Uint8Array(SINGLE_BYTES + 10)]), undefined, 0), /account is blocked/);
  assert.equal(calls.at(-1).method, 'DELETE');
});

test('parts are joined in order, and a missing part is reported', async () => {
  const data = { 0: [1, 2], 1: [3], 2: [4, 5] };
  const fetcher = async url => { const part = new URL(url).searchParams.get('part'); return new Response(new Uint8Array(data[part])); };
  const result = await downloadShare('https://api/s', 3, undefined, fetcher, 0);
  assert.deepEqual([...new Uint8Array(result.data)], [1, 2, 3, 4, 5]);
  const failed = await downloadShare('https://api/s', 2, undefined, async url => url.includes('part=1') ? new Response('', { status: 404 }) : new Response(new Uint8Array([1])), 0);
  assert.equal(failed.failed.status, 404);
});

test('an older Worker without account limits falls back to the defaults', async () => {
  server(() => Response.json({ error: 'not_found' }, { status: 404 }));
  assert.equal((await getAccount('https://api', 't')).limits.linkMiB, 24);
});
