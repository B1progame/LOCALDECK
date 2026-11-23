import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker/src/index.ts';

const env = { OWNER_TOKEN: 'a-long-test-owner-token', ALLOWED_ORIGIN: 'https://example.pages.dev' };

test('sharing API answers CORS preflight only for configured origins', async () => {
  const allowed = await worker.fetch(new Request('https://share.example/api/v1/shares', { method: 'OPTIONS', headers: { Origin: env.ALLOWED_ORIGIN } }), env);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), env.ALLOWED_ORIGIN);
  const denied = await worker.fetch(new Request('https://share.example/api/v1/shares', { method: 'OPTIONS', headers: { Origin: 'https://attacker.example' } }), env);
  assert.equal(denied.status, 403);
});

test('sharing API requires the server-side owner token for upload and management', async () => {
  const upload = await worker.fetch(new Request('https://share.example/api/v1/shares', { method: 'POST', headers: { Authorization: 'Bearer wrong-token' }, body: 'ciphertext' }), env);
  assert.equal(upload.status, 401);
  const listing = await worker.fetch(new Request('https://share.example/api/v1/shares/owner/shares'), env);
  assert.equal(listing.status, 401);
});

test('sharing API rejects unknown endpoints without revealing backend details', async () => {
  const response = await worker.fetch(new Request('https://share.example/api/v1/admin'), env);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
});
