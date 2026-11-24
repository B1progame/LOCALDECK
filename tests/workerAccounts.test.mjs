import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/worker/src/index.ts';
import { decryptSharePackage } from '../src/services/sharing.ts';
import { readZip } from '../src/services/zip.ts';

/** D1 on top of SQLite, so the real SQL runs. */
function d1() {
  const db = new DatabaseSync(':memory:');
  return { async batch(statements) { for (const statement of statements) await statement.run(); }, prepare(sql) {
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
  assert.deepEqual(changed.users, { linkMiB: 10, storageMiB: 48, perHour: 50, perDay: 15, days: 30, aiPerDay: 40, aiDays: 30 });
  assert.equal(changed.service.totalMiB, 900);
  assert.equal(changed.admins.linkMiB, 80);
  const guest = await token({ sub: 'limits-uid', email: 'limits@example.com' });
  const me = await (await call('/me', guest)).json();
  assert.deepEqual([me.admin, me.limits.linkMiB, me.limits.days], [false, 10, 30]);
  const share = await (await upload(guest)).json();
  assert.ok(Date.parse(share.expiresAt) - Date.now() > 29 * 86_400_000);
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
  assert.deepEqual((await (await call('/me', guest)).json()).limits, { linkMiB: 60, storageMiB: 200, perHour: 30, perDay: 60, days: 14, aiPerDay: 40, aiDays: 30 });
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

/* ---------- AI connections over MCP ---------- */

env.APP_URL = 'https://app.example/';
const aiOwner = await token({ sub: 'ai-uid', email: 'ai@example.com' });
const newConnection = async (credential = aiOwner, name = 'Claude') => (await call('/ai', credential, { method: 'POST', body: JSON.stringify({ name }) })).json();
let rpcId = 0;
async function rpc(url, method, params = {}, headers = {}) {
  const response = await worker.fetch(new Request(url.replace('https://share.example', 'https://share.example'), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }), env);
  return { status: response.status, body: await response.json() };
}
const tool = async (url, name, args = {}) => { const { body } = await rpc(url, 'tools/call', { name, arguments: args }); return { text: body.result.content[0].text, isError: body.result.isError }; };
const page = text => `<!doctype html><html lang="de"><title>Quiz</title><body><h1>${text}</h1></body></html>`;
const idOf = text => text.match(/project_id: (\S+)/)[1];
const linkOf = text => text.match(/person: (\S+)/)[1];
async function open(link) {
  const [, id, key] = link.match(/shared\/([0-9a-f-]+)\?k=(.+)$/);
  const blob = await call(`/${id}/blob`);
  if (blob.status !== 200) return { status: blob.status };
  const entries = await readZip(new Blob([await decryptSharePackage(await blob.arrayBuffer(), key)]));
  return { status: 200, files: Object.fromEntries(await Promise.all(entries.map(async entry => [entry.path, await entry.blob.text()]))) };
}

test('an AI connection is created once, listed without its secret, and can be revoked', async () => {
  assert.equal((await call('/ai')).status, 401);
  const { id, url } = await newConnection();
  assert.match(url, /^https:\/\/share\.example\/mcp\/ld_[A-Za-z0-9_-]{43}$/);
  const list = await (await call('/ai', aiOwner)).json();
  assert.deepEqual([list.enabled, list.connections.length, list.connections[0].name, JSON.stringify(list).includes(url.split('/').pop())], [true, 1, 'Claude', false]);
  assert.equal((await rpc(url, 'ping')).status, 200);
  assert.equal((await call(`/ai/${id}`, person, { method: 'DELETE' })).status, 404);
  assert.equal((await call(`/ai/${id}`, aiOwner, { method: 'DELETE' })).status, 200);
  assert.equal((await rpc(url, 'ping')).status, 401);
});

test('older and newer MCP clients are both served', async () => {
  const { url } = await newConnection();
  const hello = await rpc(url, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
  assert.deepEqual([hello.status, hello.body.result.protocolVersion, hello.body.result.serverInfo.name], [200, '2025-06-18', 'localdeck']);
  assert.equal((await rpc(url, 'initialize', { protocolVersion: '1999-01-01' })).body.result.protocolVersion, '2025-11-25');
  const note = await worker.fetch(new Request(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), env);
  assert.equal(note.status, 202);
  assert.deepEqual((await rpc(url, 'tools/list')).body.result.tools.map(entry => entry.name), ['create_project', 'update_project', 'read_project', 'list_projects', 'delete_project']);
  assert.equal((await worker.fetch(new Request(url), env)).status, 405);
  const meta = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } };
  const headers = method => ({ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method });
  const discover = await rpc(url, 'server/discover', meta, headers('server/discover'));
  assert.deepEqual([discover.status, discover.body.result.resultType, discover.body.result.supportedVersions[0]], [200, 'complete', '2026-07-28']);
  const list = await rpc(url, 'tools/list', meta, headers('tools/list'));
  assert.deepEqual([list.body.result.resultType, list.body.result.cacheScope, list.body.result.ttlMs > 0], ['complete', 'private', true]);
  assert.deepEqual([(await rpc(url, 'tools/list', meta, headers('tools/call'))).body.error.code, (await rpc(url, 'tools/call', { ...meta, name: 'list_projects' }, headers('tools/call'))).body.error.code], [-32020, -32020]);
  const called = await rpc(url, 'tools/call', { ...meta, name: 'list_projects', arguments: {} }, { ...headers('tools/call'), 'Mcp-Name': 'list_projects' });
  assert.deepEqual([called.status, called.body.result.resultType, called.body.result.isError], [200, 'complete', false]);
  const unknown = await rpc(url, 'tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2030-01-01' } }, {});
  assert.deepEqual([unknown.status, unknown.body.error.code, unknown.body.error.data.supported[0]], [400, -32022, '2026-07-28']);
  assert.equal((await rpc(url, 'resources/list', meta, headers('resources/list'))).status, 404);
});

test('an AI creates a project, the link opens it, and an update keeps the link', async () => {
  const { url } = await newConnection();
  const created = await tool(url, 'create_project', { title: 'Photosynthese-Quiz', type: 'quiz', subject: 'Biologie', tags: ['bio'], language: 'de', files: [{ path: 'index.html', content: page('Frage 1') }, { path: 'cover.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>' }, { path: 'assets/a.png', content: 'iVBORw0KGgo=', encoding: 'base64' }] });
  assert.equal(created.isError, false, created.text);
  const id = idOf(created.text), link = linkOf(created.text);
  assert.match(link, /^https:\/\/app\.example\/#\/shared\/[0-9a-f-]{36}\?k=[A-Za-z0-9_-]{43}$/);
  const first = await open(link);
  const manifest = JSON.parse(first.files['localdeck.json']);
  assert.deepEqual([manifest.title, manifest.type, manifest.subject, manifest.entry, manifest.cover, manifest.schemaVersion], ['Photosynthese-Quiz', 'quiz', 'Biologie', 'index.html', 'cover.svg', 1]);
  const updated = await tool(url, 'update_project', { project_id: id, edits: [{ path: 'index.html', find: 'Frage 1', replace: 'Frage 1 und $& 2' }], files: [{ path: 'extra.js', content: 'let a' }], remove: ['assets/a.png'], title: 'Neues Quiz' });
  assert.equal(updated.isError, false, updated.text);
  assert.equal(linkOf(updated.text), link);
  const second = await open(link);
  assert.match(second.files['index.html'], /Frage 1 und \$& 2/);
  assert.deepEqual([Object.keys(second.files).sort(), JSON.parse(second.files['localdeck.json']).title, JSON.parse(second.files['localdeck.json']).subject], [['cover.svg', 'extra.js', 'index.html', 'localdeck.json'], 'Neues Quiz', 'Biologie']);
  assert.match((await tool(url, 'read_project', { project_id: id, path: 'index.html' })).text, /Frage 1 und/);
  const list = JSON.parse((await tool(url, 'list_projects')).text);
  assert.deepEqual([list[0].title, list[0].link, list[0].version], ['Neues Quiz', link, 2]);
  const own = (await (await call('/owner/shares', aiOwner)).json()).find(share => share.id === id);
  assert.deepEqual([own.ai, own.label], [true, 'Project from your AI']);
  assert.equal((await tool(url, 'delete_project', { project_id: id })).isError, false);
  assert.equal((await open(link)).status, 410);
  assert.equal(await SHARES_DB.prepare('SELECT id FROM ai_projects WHERE id = ?').bind(id).first(), null);
  assert.equal(await SHARES_DB.prepare('SELECT id FROM blobs WHERE id = ?').bind(id).first(), null);
});

test('the database holds nothing readable about an AI project', async () => {
  const { url } = await newConnection();
  const created = await tool(url, 'create_project', { title: 'Geheimtitel', files: [{ path: 'index.html', content: page('Geheimtext') }] });
  const key = linkOf(created.text).split('k=')[1];
  const row = await SHARES_DB.prepare('SELECT * FROM ai_projects WHERE id = ?').bind(idOf(created.text)).first();
  const blob = await SHARES_DB.prepare('SELECT * FROM blobs WHERE id = ?').bind(idOf(created.text)).first();
  const everything = JSON.stringify(row) + JSON.stringify(blob) + atob(blob.data) + atob(row.sealed) + JSON.stringify(await SHARES_DB.prepare('SELECT * FROM ai_tokens').bind().all());
  for (const secret of ['Geheimtitel', 'Geheimtext', key, url.split('/').pop()]) assert.equal(everything.includes(secret), false, secret);
});

test('a connection only reaches its own projects', async () => {
  const one = await newConnection(), two = await newConnection();
  const id = idOf((await tool(one.url, 'create_project', { title: 'A', files: [{ path: 'index.html', content: page('A') }] })).text);
  for (const [name, args] of [['read_project', {}], ['update_project', { title: 'B' }], ['delete_project', {}]]) assert.equal((await tool(two.url, name, { project_id: id, ...args })).isError, true, name);
  const share = await (await upload(aiOwner)).json();
  assert.equal((await tool(one.url, 'delete_project', { project_id: share.id })).isError, true);
  assert.equal((await call(`/${share.id}`)).status, 200);
});

test('wrong input is explained to the AI', async () => {
  const guest = await token({ sub: 'ai-input', email: 'ai-input@example.com' });
  const { url } = await newConnection(guest);
  const fails = async (args, expected) => { const result = await tool(url, 'create_project', args); assert.equal(result.isError, true); assert.match(result.text, expected); };
  await fails({ title: 'A', files: [] }, /index\.html/);
  await fails({ files: [{ path: 'index.html', content: 'x' }] }, /title/);
  await fails({ title: 'A', files: [{ path: '../x', content: 'x' }] }, /Unsafe/);
  await fails({ title: 'A', type: 'virus', files: [{ path: 'index.html', content: 'x' }] }, /type/);
  await fails({ title: 'A', files: [{ path: 'index.html', content: 'x'.repeat(1100 * 1024) }] }, /1 MiB/);
  await fails({ title: 'A', files: [{ path: 'index.html', content: 'x' }, { path: 'INDEX.html', content: 'x' }] }, /same name/);
  const id = idOf((await tool(url, 'create_project', { title: 'A', files: [{ path: 'index.html', content: 'aa bb aa' }] })).text);
  assert.match((await tool(url, 'update_project', { project_id: id, edits: [{ path: 'index.html', find: 'aa', replace: 'c' }] })).text, /2 times/);
  assert.match((await tool(url, 'update_project', { project_id: id, edits: [{ path: 'index.html', find: 'zz', replace: 'c' }] })).text, /does not appear/);
  assert.match((await tool(url, 'update_project', { project_id: id, remove: ['index.html'] })).text, /cannot be removed/);
  assert.equal((await tool(url, 'nonsense')).isError, true);
});

test('limits, the admin switch and blocking apply to AI connections', async () => {
  const guest = await token({ sub: 'ai-limits', email: 'ai-limits@example.com' });
  const { url } = await newConnection(guest);
  const path = `/admin/accounts/${encodeURIComponent('firebase:ai-limits')}`;
  await asAdmin(path, 'PUT', { limits: { linkMiB: 10, storageMiB: 48, perHour: 5, perDay: 5, days: 3, aiPerDay: 1, aiDays: 5 } });
  const make = () => tool(url, 'create_project', { title: 'A', files: [{ path: 'index.html', content: page('A') }] });
  assert.equal((await make()).isError, false);
  assert.match((await make()).text, /1 AI changes per day/);
  await asAdmin('/admin/limits', 'PUT', { service: { ai: false } });
  assert.equal((await rpc(url, 'tools/list')).status, 403);
  assert.equal((await call('/ai', guest, { method: 'POST', body: '{}' })).status, 403);
  await asAdmin('/admin/limits', 'PUT', { service: { ai: true } });
  assert.equal((await rpc(url, 'tools/list')).status, 200);
  await asAdmin(path, 'PUT', { blocked: true });
  assert.equal((await rpc(url, 'tools/list')).status, 403);
  const data = await overview();
  assert.ok(data.ai.connections >= 5 && data.ai.projects >= 2 && data.ai.changes >= 3);
});

test('one account has at most five connections', async () => {
  const guest = await token({ sub: 'ai-many', email: 'ai-many@example.com' });
  for (let i = 0; i < 5; i++) assert.ok((await newConnection(guest)).url);
  assert.equal((await newConnection(guest)).error, 'too_many_connections');
});

test('guessing connection addresses is limited', async () => {
  let last = 0;
  for (let i = 0; i < 242; i++) last = (await worker.fetch(new Request(`https://share.example/mcp/ld_${'A'.repeat(43)}`, { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' }, body: '{}' }), env)).status;
  assert.equal(last, 429);
});

/* ---------- Several databases ---------- */

const three = { ...env, PROJECTS_DB_2: d1(), PROJECTS_DB_3: d1() };
const onThree = (path, credential, init = {}) => worker.fetch(new Request(SHARES + path, { ...init, headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...init.headers } }), three);
const sendThree = (size = 300 * 1024, fill = 7) => onThree('', admin, { method: 'POST', body: new Uint8Array(size).fill(fill), headers: { 'content-length': String(size) } });
const storeOf = async id => (await SHARES_DB.prepare('SELECT store, version, bytes FROM blob_index WHERE id = ?').bind(id).first());

test('projects are spread over all databases, and each one can be read back', async () => {
  const ids = [];
  for (let i = 0; i < 9; i++) { const { id } = await (await sendThree(300 * 1024, i)).json(); ids.push(id); }
  assert.deepEqual([...new Set(await Promise.all(ids.map(async id => (await storeOf(id)).store)))].sort(), [1, 2, 3]);
  for (const [i, id] of ids.entries()) { const bytes = new Uint8Array(await (await onThree(`/${id}/blob`)).arrayBuffer()); assert.deepEqual([bytes.length, bytes[0], bytes.at(-1)], [300 * 1024, i, i]); }
  const data = await (await onThree('/admin/overview', admin)).json();
  assert.deepEqual([data.databases.map(entry => entry.name), data.databases.every(entry => entry.projects > 0 && entry.bytes > 0)], [['localdeck-shares', 'localdeck-projects-2', 'localdeck-projects-3'], true]);
  for (const id of ids) assert.equal((await onThree(`/${id}`, admin, { method: 'DELETE' })).status, 200);
  for (const db of [SHARES_DB, three.PROJECTS_DB_2, three.PROJECTS_DB_3]) for (const id of ids) assert.equal(await db.prepare('SELECT id FROM blobs WHERE id = ?').bind(id).first(), null);
});

test('when one database fails, uploads go to the others and its projects report a clear error', async () => {
  const inTwo = []; for (let i = 0; i < 6 && !inTwo.length; i++) { const { id } = await (await sendThree()).json(); if ((await storeOf(id)).store === 2) inTwo.push(id); }
  const broken = { prepare() { throw new Error('D1_ERROR: unavailable'); } };
  const partly = { ...three, PROJECTS_DB_2: broken, PROJECTS_DB_3: broken };
  const size = 1000;
  const response = await worker.fetch(new Request(SHARES, { method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'content-length': String(size) }, body: new Uint8Array(size) }), partly);
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.equal((await storeOf(id)).store, 1);
  if (inTwo.length) assert.equal((await worker.fetch(new Request(`${SHARES}/${inTwo[0]}/blob`), partly)).status, 503);
  assert.equal((await onThree(`/${id}/blob`)).status, 200);
});

test('large projects still use KV, small ones do not', async () => {
  const large = await (await sendThree(2 * 1024 * 1024)).json(), small = await (await sendThree(1000)).json();
  assert.deepEqual([three.SHARES_KV.store.has(large.id), three.SHARES_KV.store.has(small.id), await storeOf(large.id)], [true, false, null]);
});

test('an AI project keeps its link when a change moves it to another database', async () => {
  const guest = await token({ sub: 'ai-move', email: 'ai-move@example.com' });
  const { url } = await (await onThree('/ai', guest, { method: 'POST', body: '{"name":"x"}' })).json();
  const run = async (name, args) => (await (await worker.fetch(new Request(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), three)).json()).result;
  const created = (await run('create_project', { title: 'Move', files: [{ path: 'index.html', content: page('A'.repeat(200_000)) }] })).content[0].text;
  const id = idOf(created), seen = new Set([(await storeOf(id)).store]);
  for (let i = 0; i < 6; i++) { const result = await run('update_project', { project_id: id, files: [{ path: 'index.html', content: page(String(i).repeat(200_000)) }] }); assert.equal(result.isError, false, result.content[0].text); assert.equal(linkOf(result.content[0].text), linkOf(created)); seen.add((await storeOf(id)).store); }
  assert.ok(seen.size > 1);
  let rows = 0;
  for (const db of [SHARES_DB, three.PROJECTS_DB_2, three.PROJECTS_DB_3]) rows += (await db.prepare('SELECT COUNT(*) as n FROM blobs WHERE id = ?').bind(id).first()).n;
  assert.equal(rows, 1);
  const both = await Promise.all([run('update_project', { project_id: id, title: 'One' }), run('update_project', { project_id: id, title: 'Two' })]);
  assert.ok(both.some(result => !result.isError));
  const now = JSON.parse((await run('list_projects', {})).content[0].text)[0];
  assert.ok(['One', 'Two'].includes(now.title));
  assert.equal((await run('read_project', { project_id: id, path: 'index.html' })).isError, false);
});

test('the cleanup empties all databases of expired projects', async () => {
  const ids = []; for (let i = 0; i < 6; i++) ids.push((await (await sendThree()).json()).id);
  for (const id of ids) await SHARES_DB.prepare('UPDATE shares SET expires_at = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), id).run();
  let done; await worker.scheduled({}, three, { waitUntil(promise) { done = promise; } }); await done;
  for (const db of [SHARES_DB, three.PROJECTS_DB_2, three.PROJECTS_DB_3]) for (const id of ids) assert.equal(await db.prepare('SELECT id FROM blobs WHERE id = ?').bind(id).first(), null);
  assert.equal(await storeOf(ids[0]), null);
});
