import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/worker/src/index.ts';

/** D1 on top of SQLite, so the real SQL runs. */
function d1() {
  const db = new DatabaseSync(':memory:');
  return { prepare(sql) {
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      async run() { return db.prepare(sql).run(...values); },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async all() { return { results: db.prepare(sql).all(...values) }; },
    };
  } };
}

const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key' };
const pkcs8 = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----\n`;

async function token(claims) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', kid: 'test-key' })}.${b64({ iss: 'https://securetoken.google.com/demo', aud: 'demo', iat: now, exp: now + 3000, email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...claims })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${Buffer.from(signature).toString('base64url')}`;
}

const sentMails = [];
let relayAnswer = { ok: true };
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('securetoken@system')) return Response.json({ keys: [jwk] });
  if (url.startsWith('https://oauth2.googleapis.com/')) return Response.json({ access_token: 'admin-token' });
  if (url.includes('accounts:sendOobCode')) return Response.json({ oobLink: 'https://demo.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=code%2B1&apiKey=x' });
  if (url === 'https://relay.example/exec') { sentMails.push(JSON.parse(init.body)); return Response.json(relayAnswer); }
  throw new Error(`unexpected request ${url}`);
};

const SHARES = 'https://share.example/api/v1/shares';
const SHARES_DB = d1();
const env = {
  ALLOWED_ORIGIN: 'https://example.pages.dev', FIREBASE_PROJECT_ID: 'demo', ADMIN_EMAILS: 'Admin@Example.com', SHARES_DB,
  SHARES_KV: { async put() {}, async delete() {}, async get() { return new ArrayBuffer(64); } },
};
const mailEnv = { ...env, APP_URL: 'https://app.example/', MAIL_RELAY_URL: 'https://relay.example/exec', MAIL_RELAY_SECRET: 'relay-secret', FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'mail@demo.iam', private_key: pkcs8, project_id: 'demo' }) };
const call = (path, credential, init = {}) => worker.fetch(new Request(SHARES + path, { ...init, headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...init.headers } }), env);
const upload = credential => call('', credential, { method: 'POST', body: new Uint8Array(64), headers: { 'content-length': '64' } });
const signIn = async credential => (await worker.fetch(new Request(`${SHARES}/auth/firebase`, { method: 'POST', body: JSON.stringify({ credential }) }), env)).json();
const mail = (credential, target = mailEnv) => worker.fetch(new Request(`${SHARES}/auth/verification`, { method: 'POST', body: JSON.stringify({ credential }) }), target);

const admin = await token({ sub: 'admin-uid', email: 'admin@example.com' });
const person = await token({ sub: 'person-uid', email: 'person@example.com' });

test('only the Google sign-in of a listed address is admin', async () => {
  assert.equal((await signIn(admin)).admin, true);
  assert.equal((await signIn(person)).admin, false);
  assert.equal((await signIn(await token({ sub: 'x', email: 'admin@example.com', firebase: { sign_in_provider: 'password' } }))).admin, false);
  assert.equal((await signIn(await token({ sub: 'x', email: 'admin@example.com', email_verified: false }))).error, 'unauthorized');
});

test('the overview is closed to everyone but the admin', async () => {
  assert.equal((await call('/admin/overview')).status, 401);
  assert.equal((await call('/admin/overview', person)).status, 403);
});

test('the admin sees all links without addresses and can delete any of them', async () => {
  const { id } = await (await upload(person)).json();
  const mine = await (await upload(admin)).json();
  const response = await call('/admin/overview', admin);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /@/);
  const data = JSON.parse(text);
  assert.deepEqual([data.totals.links, data.totals.owners, data.totals.bytes, data.totals.uploadsToday], [2, 2, 128, 2]);
  assert.equal(data.shares.find(share => share.id === id).mine, false);
  assert.equal(data.shares.find(share => share.id === mine.id).mine, true);
  assert.equal((await call(`/${mine.id}`, person, { method: 'DELETE' })).status, 404);
  assert.equal((await call(`/${id}`, admin, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/${id}`)).status, 410);
  const freed = await SHARES_DB.prepare('SELECT active_bytes FROM user_storage WHERE owner_id = ?').bind('firebase:person-uid').first();
  assert.equal(freed.active_bytes, 0);
});

test('the hourly upload limit applies to people but not to the admin', async () => {
  for (let i = 0; i < 6; i++) assert.equal((await upload(admin)).status, 201);
  const results = [];
  for (let i = 0; i < 6; i++) results.push((await upload(person)).status);
  assert.equal(results.at(-1), 429);
});

test('without a mail service the app is told to use the Firebase email', async () => {
  const response = await mail(person, env);
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error, 'mail_not_configured');
});

test('the confirmation email goes to the signed address with a LocalDeck link, once per two minutes', async () => {
  const unverified = await token({ sub: 'new-uid', email: 'new@example.com', email_verified: false, name: 'New Person' });
  assert.equal((await mail(unverified)).status, 200);
  assert.deepEqual(sentMails, [{ secret: 'relay-secret', to: 'new@example.com', name: 'New Person', link: 'https://app.example/?mode=verifyEmail&oobCode=code%2B1' }]);
  const again = await mail(unverified);
  assert.equal(again.status, 429);
  assert.equal((await again.json()).error, 'mail_wait');
  assert.equal(sentMails.length, 1);
});

test('a forged token sends nothing, and a confirmed address needs no email', async () => {
  const forged = `${(await token({ sub: 'f', email: 'f@example.com', email_verified: false })).split('.').slice(0, 2).join('.')}.AAAA`;
  assert.equal((await mail(forged)).status, 401);
  assert.equal((await (await mail(person)).json()).alreadyVerified, true);
  assert.equal(sentMails.length, 1);
});

test('a failed relay frees the lock so the next try is not blocked', async () => {
  const unverified = await token({ sub: 'retry-uid', email: 'retry@example.com', email_verified: false });
  relayAnswer = { ok: false, error: 'daily_limit' };
  assert.equal((await mail(unverified)).status, 502);
  relayAnswer = { ok: true };
  assert.equal((await mail(unverified)).status, 200);
});

test('a short database outage does not break an open link', async () => {
  const { id } = await (await upload(admin)).json();
  let failures = 1;
  const flaky = { prepare(sql) { if (sql.startsWith('SELECT id, status') && failures-- > 0) throw new Error('D1_ERROR: network connection lost'); return SHARES_DB.prepare(sql); } };
  const response = await worker.fetch(new Request(`${SHARES}/${id}`), { ...env, SHARES_DB: flaky });
  assert.equal(response.status, 200);
});

test('the first sign-in after Google replaced its keys works', async () => {
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes('securetoken@system')) return previous(input, init);
    requests++;
    return Response.json({ keys: [{ ...jwk, kid: 'rotated-key' }] });
  };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', kid: 'rotated-key' })}.${b64({ iss: 'https://securetoken.google.com/demo', aud: 'demo', iat: now, exp: now + 3000, sub: 'rotated', email: 'rotated@example.com', email_verified: true })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned));
  assert.equal((await signIn(`${unsigned}.${Buffer.from(signature).toString('base64url')}`)).email, 'rotated@example.com');
  assert.equal(requests, 1);
  globalThis.fetch = previous;
});

test('too many requests is reported as such, not as an expired sign-in', async () => {
  let last = 0;
  for (let i = 0; i < 122; i++) last = (await call('/owner/shares', 'a.b.c', { headers: { 'CF-Connecting-IP': '198.51.100.7' } })).status;
  assert.equal(last, 429);
});
