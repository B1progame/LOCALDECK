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

function kv() {
  const store = new Map();
  return { store, async put(key, value, options) { store.set(key, { value, ttl: options.expirationTtl }); }, async delete(key) { store.delete(key); }, async get(key) { return store.get(key)?.value ?? null; } };
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
  SHARES_KV: kv(),
};
const mailEnv = { ...env, APP_URL: 'https://app.example/', MAIL_RELAY_URL: 'https://relay.example/exec', MAIL_RELAY_SECRET: 'relay-secret', FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'mail@demo.iam', private_key: pkcs8, project_id: 'demo' }) };
const call = (path, credential, init = {}) => worker.fetch(new Request(SHARES + path, { ...init, headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...init.headers } }), env);
const upload = credential => call('', credential, { method: 'POST', body: new Uint8Array(64), headers: { 'content-length': '64' } });
const signIn = async credential => (await worker.fetch(new Request(`${SHARES}/auth/firebase`, { method: 'POST', body: JSON.stringify({ credential }) }), env)).json();
const mail = (credential, target = mailEnv, language = undefined) => worker.fetch(new Request(`${SHARES}/auth/verification`, { method: 'POST', body: JSON.stringify({ credential, language }) }), target);

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

test('the admin sees accounts and links, and can delete any link', async () => {
  const { id } = await (await upload(person)).json();
  const mine = await (await upload(admin)).json();
  const response = await call('/admin/overview', admin);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual([data.totals.links, data.totals.owners, data.totals.bytes, data.totals.uploadsToday], [2, 2, 128, 2]);
  const account = data.accounts.find(entry => entry.email === 'person@example.com');
  assert.deepEqual([account.uploads, account.links, account.bytes, account.uploadedBytes, account.provider, account.blocked], [1, 1, 64, 64, 'google.com', false]);
  assert.deepEqual([data.days.length, data.days[0].uploads, data.days[0].bytes], [1, 2, 128]);
  assert.equal(data.shares.find(share => share.id === id).owner, 'person@example.com');
  assert.equal(data.shares.find(share => share.id === id).mine, false);
  assert.equal(data.shares.find(share => share.id === mine.id).mine, true);
  assert.equal((await call(`/${mine.id}`, person, { method: 'DELETE' })).status, 404);
  assert.equal((await call(`/${id}`, admin, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/${id}`)).status, 410);
  assert.equal(env.SHARES_KV.store.has(id), false);
  assert.equal((await (await call('/me', person)).json()).usage.bytes, 0);
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
  assert.equal((await mail(unverified, mailEnv, 'de')).status, 200);
  assert.deepEqual(sentMails, [{ secret: 'relay-secret', to: 'new@example.com', name: 'New Person', link: 'https://app.example/?mode=verifyEmail&oobCode=code%2B1', language: 'de' }]);
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
  for (let i = 0; i < 242; i++) last = (await call('/owner/shares', 'a.b.c', { headers: { 'CF-Connecting-IP': '198.51.100.7' } })).status;
  assert.equal(last, 429);
});

const asAdmin = (path, method, body) => call(path, admin, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const overview = async () => (await call('/admin/overview', admin)).json();

test('downloads are counted per link, per account and per day', async () => {
  const { id } = await (await upload(admin)).json();
  const before = (await overview()).days[0].downloads;
  assert.equal((await call(`/${id}/blob`)).status, 200);
  assert.equal((await call(`/${id}/blob`)).status, 200);
  const data = await overview();
  assert.equal(data.shares.find(share => share.id === id).downloads, 2);
  assert.equal(data.days[0].downloads - before, 2);
  assert.ok(data.accounts.find(account => account.mine).downloads >= 2);
});

test('limits can be changed by the admin only, and stay within what the service can carry', async () => {
  assert.equal((await call('/admin/limits', person, { method: 'PUT', body: '{}' })).status, 403);
  const changed = await (await asAdmin('/admin/limits', 'PUT', { users: { linkMiB: 10, storageMiB: 99999, perHour: 50, perDay: 2.5, days: 30 }, service: { totalMiB: 900, open: true } })).json();
  assert.deepEqual(changed.users, { linkMiB: 10, storageMiB: 48, perHour: 50, perDay: 15, days: 30 });
  assert.equal(changed.service.totalMiB, 900);
  assert.equal(changed.admins.linkMiB, 80);
  const guest = await token({ sub: 'limits-uid', email: 'limits@example.com' });
  const me = await (await call('/me', guest)).json();
  assert.deepEqual([me.admin, me.limits.linkMiB, me.limits.days], [false, 10, 30]);
  const share = await (await upload(guest)).json();
  assert.ok(Date.parse(share.expiresAt) - Date.now() > 29 * 86_400_000);
  assert.equal(env.SHARES_KV.store.get(share.id).ttl, 30 * 86_400);
  const large = new Uint8Array(11 * 1024 * 1024);
  assert.equal((await call('', guest, { method: 'POST', body: large, headers: { 'content-length': String(large.length) } })).status, 413);
});

test('uploads can be paused for everyone but the admin', async () => {
  const guest = await token({ sub: 'paused-uid', email: 'paused@example.com' });
  await asAdmin('/admin/limits', 'PUT', { service: { open: false } });
  const refused = await upload(guest);
  assert.deepEqual([refused.status, (await refused.json()).error], [503, 'uploads_paused']);
  assert.equal((await upload(admin)).status, 201);
  await asAdmin('/admin/limits', 'PUT', { service: { open: true } });
  assert.equal((await upload(guest)).status, 201);
});

test('one account can get its own limits', async () => {
  const guest = await token({ sub: 'own-uid', email: 'own@example.com' });
  await signIn(guest);
  const path = `/admin/accounts/${encodeURIComponent('firebase:own-uid')}`;
  assert.equal((await asAdmin(path, 'PUT', { limits: { linkMiB: 60, storageMiB: 200, perHour: 30, perDay: 60, days: 14 } })).status, 200);
  assert.deepEqual((await (await call('/me', guest)).json()).limits, { linkMiB: 60, storageMiB: 200, perHour: 30, perDay: 60, days: 14 });
  assert.equal((await asAdmin(path, 'PUT', { limits: null })).status, 200);
  assert.equal((await (await call('/me', guest)).json()).limits.linkMiB, 10);
  assert.equal((await asAdmin('/admin/accounts/firebase%3Anobody', 'PUT', { blocked: true })).status, 409);
});

test('a blocked account cannot sign in or upload, and an admin cannot block their own account', async () => {
  const guest = await token({ sub: 'blocked-uid', email: 'blocked@example.com' });
  await signIn(guest);
  const path = `/admin/accounts/${encodeURIComponent('firebase:blocked-uid')}`;
  assert.equal((await asAdmin(path, 'PUT', { blocked: true })).status, 200);
  assert.equal((await signIn(guest)).error, 'blocked');
  assert.deepEqual([(await upload(guest)).status], [403]);
  assert.equal((await asAdmin(path, 'PUT', { blocked: false })).status, 200);
  assert.equal((await upload(guest)).status, 201);
  assert.equal((await asAdmin(`/admin/accounts/${encodeURIComponent('firebase:admin-uid')}`, 'PUT', { blocked: true })).status, 409);
  const removed = await (await asAdmin(path + '/shares', 'DELETE')).json();
  assert.equal(removed.removed, 1);
  const log = (await overview()).log.map(entry => entry.action);
  assert.deepEqual(log.slice(0, 3), ['delete_links', 'unblock', 'block']);
});

test('a large project is uploaded in parts and only opens when complete', async () => {
  const part = 20 * 1024 * 1024, total = part + 1000;
  const send = (path, method, size, extra = {}) => call(path, admin, { method, body: new Uint8Array(size).fill(7), headers: { 'content-length': String(size), ...extra } });
  const first = await send('', 'POST', part, { 'x-share-size': String(total), 'x-share-parts': '2' });
  assert.equal(first.status, 201);
  const { id, parts } = await first.json();
  assert.equal(parts, 2);
  assert.equal((await call(`/${id}`)).status, 410);
  assert.equal((await send(`/${id}/parts/1`, 'PUT', 999)).status, 413);
  assert.equal((await send(`/${id}/parts/2`, 'PUT', 1000)).status, 404);
  assert.equal((await call(`/${id}/parts/1`, person, { method: 'PUT', body: new Uint8Array(1000), headers: { 'content-length': '1000' } })).status, 404);
  assert.deepEqual(await (await send(`/${id}/parts/1`, 'PUT', 1000)).json(), { complete: true });
  assert.deepEqual([(await (await call(`/${id}`)).json()).parts, (await (await call(`/${id}/blob?part=1`)).arrayBuffer()).byteLength, (await call(`/${id}/blob?part=2`)).status], [2, 1000, 404]);
  assert.equal((await call(`/${id}`, admin, { method: 'DELETE' })).status, 200);
  assert.deepEqual([env.SHARES_KV.store.has(id), env.SHARES_KV.store.has(`${id}.1`)], [false, false]);
});

test('wrong part counts and sizes are refused', async () => {
  const send = (size, extra) => call('', admin, { method: 'POST', body: new Uint8Array(size), headers: { 'content-length': String(size), ...extra } });
  assert.equal((await send(100, { 'x-share-size': String(81 * 1024 * 1024), 'x-share-parts': '5' })).status, 413);
  assert.equal((await send(100, { 'x-share-size': '100', 'x-share-parts': '3' })).status, 413);
  assert.equal((await send(100, { 'x-share-size': 'x' })).status, 413);
});

test('the storage limit of an account holds', async () => {
  const guest = await token({ sub: 'full-uid', email: 'full@example.com' });
  await signIn(guest);
  await asAdmin(`/admin/accounts/${encodeURIComponent('firebase:full-uid')}`, 'PUT', { limits: { linkMiB: 1, storageMiB: 1, perHour: 50, perDay: 50, days: 3 } });
  const body = () => ({ method: 'POST', body: new Uint8Array(600 * 1024), headers: { 'content-length': String(600 * 1024) } });
  const both = await Promise.all([call('', guest, body()), call('', guest, body())]);
  assert.deepEqual(both.map(response => response.status).sort(), [201, 429]);
  const refused = await call('', guest, body());
  assert.equal((await refused.json()).error, 'user_storage_limit');
});

test('the cleanup removes unfinished uploads and expired links', async () => {
  const { id } = await (await upload(admin)).json();
  await SHARES_DB.prepare("UPDATE shares SET status = 'revoked', created_at = ? WHERE id = ?").bind(new Date(Date.now() - 3_600_000).toISOString(), id).run();
  const second = await (await upload(admin)).json();
  await SHARES_DB.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), second.id).run();
  let done;
  await worker.scheduled({}, env, { waitUntil(promise) { done = promise; } });
  await done;
  assert.equal(env.SHARES_KV.store.has(id), false);
  assert.equal(await SHARES_DB.prepare('SELECT id FROM shares WHERE id IN (?, ?)').bind(id, second.id).first(), null);
});
