import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker/src/index.ts';

const env = { OWNER_TOKEN: 'a-long-test-owner-token', ALLOWED_ORIGIN: 'https://example.pages.dev' };

function authDb() {
  const counts = new Map();
  return { prepare(sql) {
    let key;
    return { bind(hash, windowStart) { key = `${hash}:${windowStart}`; return this; },
      async run() { counts.set(key, (counts.get(key) ?? 0) + 1); },
      async first() { return { attempts: counts.get(key) ?? 0 }; },
    };
  } };
}

test('sharing API answers CORS preflight only for configured origins', async () => {
  const allowed = await worker.fetch(new Request('https://share.example/api/v1/shares', { method: 'OPTIONS', headers: { Origin: env.ALLOWED_ORIGIN } }), env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), env.ALLOWED_ORIGIN);
  const denied = await worker.fetch(new Request('https://share.example/api/v1/shares', { method: 'OPTIONS', headers: { Origin: 'https://attacker.example' } }), env);
  assert.equal(denied.status, 403);
});

test('sharing API requires the server-side owner token for upload and management', async () => {
  const protectedEnv = { ...env, SHARES_DB: authDb() };
  const upload = await worker.fetch(new Request('https://share.example/api/v1/shares', { method: 'POST', headers: { Authorization: 'Bearer wrong-token' }, body: 'ciphertext' }), protectedEnv);
  assert.equal(upload.status, 401);
  const listing = await worker.fetch(new Request('https://share.example/api/v1/shares/owner/shares'), protectedEnv);
  assert.equal(listing.status, 401);
});

test('sharing API rejects unknown endpoints without revealing backend details', async () => {
  const response = await worker.fetch(new Request('https://share.example/api/v1/admin'), env);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
});

test('a failing database returns JSON with CORS instead of a bare crash', async () => {
  const brokenDb = { prepare() { return { bind() { return this; }, async run() { throw new Error('no such table'); }, async first() { throw new Error('no such table'); } }; } };
  const response = await worker.fetch(new Request('https://share.example/api/v1/shares/auth/firebase', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN, 'content-type': 'application/json' }, body: '{"credential":"x.y.z"}' }), { ...env, SHARES_DB: brokenDb });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('access-control-allow-origin'), env.ALLOWED_ORIGIN);
  assert.deepEqual(await response.json(), { error: 'service_unavailable' });
});

test('several allowed origins can be configured', async () => {
  const multi = { ...env, ALLOWED_ORIGIN: 'https://example.pages.dev, http://localhost:5468' };
  const local = await worker.fetch(new Request('https://share.example/api/v1/shares', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5468' } }), multi);
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5468');
});
