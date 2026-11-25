/* npm run dev:admin
   LocalDeck with its own sharing service on this computer, sample data and a test admin. For developing and looking at
   the admin page. Everything is in memory and gone when it stops.

   It is no way into the real service: the sign-in is signed with a key that is made new at every start and that only
   this process accepts. It listens on this computer only, and the button exists only in the development build. */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const API_PORT = 8791, SITE_PORT = 5469, SITE = `http://localhost:${SITE_PORT}`;
const ADMIN = { sub: 'claude-local', email: 'claude@localdeck.test', name: 'Claude (local test admin)' };
const DAY = 86_400_000;

function d1() {
  const db = new DatabaseSync(':memory:');
  const statement = (sql, values) => ({
    bind: (...next) => statement(sql, next),
    run: async () => db.prepare(sql).run(...values),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  });
  return { prepare: sql => statement(sql, []), batch: async list => { for (const entry of list) await entry.run(); } };
}
function kv() {
  const store = new Map();
  return { put: async (key, value) => { store.set(key, value); }, get: async key => store.get(key) ?? null, delete: async key => { store.delete(key); } };
}

/* A sign-in service of its own. The Worker checks these tokens exactly like real ones. */
const code = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'local' };
async function signIn(person) {
  const now = Math.floor(Date.now() / 1000);
  const text = `${code({ alg: 'RS256', kid: 'local' })}.${code({ iss: 'https://securetoken.google.com/local-test', aud: 'local-test', iat: now, exp: now + 3600, email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...person })}`;
  return `${text}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(text))).toString('base64url')}`;
}
globalThis.fetch = async input => {
  if (String(input?.url ?? input).includes('securetoken@system')) return Response.json({ keys: [jwk] });
  throw new Error('The local test service has no internet.');
};

const { default: worker } = await import('../cloudflare/worker/src/index.ts');
const env = { SHARES_DB: d1(), PROJECTS_DB_2: d1(), PROJECTS_DB_3: d1(), SHARES_KV: kv(), FIREBASE_PROJECT_ID: 'local-test', ADMIN_EMAILS: ADMIN.email, ALLOWED_ORIGIN: SITE, APP_URL: `${SITE}/` };
const API = `http://localhost:${API_PORT}`, SHARES = `${API}/api/v1/shares`;
const call = (path, init = {}) => worker.fetch(new Request(SHARES + path, init), env);

/* Sample data, made through the real service where that is possible. */
async function seed() {
  const run = (sql, ...values) => env.SHARES_DB.prepare(sql).bind(...values).run();
  const people = ['anna', 'ben', 'cem', 'dora', 'elif'];
  for (const [index, name] of people.entries()) {
    const token = await signIn({ sub: name, email: `${name}@example.com`, name: name[0].toUpperCase() + name.slice(1) });
    await call('/auth/firebase', { method: 'POST', body: JSON.stringify({ credential: token }) });
    for (let i = 0; i < index; i++) { const body = new Uint8Array(40_000 * (i + 1)); await call('', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-length': String(body.length) }, body }); }
    await run('UPDATE accounts SET first_seen = ?, last_seen = ? WHERE owner_id = ?', Date.now() - (index + 3) * 9 * DAY, Date.now() - index * 3 * DAY, `firebase:${name}`);
  }
  await run("UPDATE accounts SET blocked = 1 WHERE owner_id = 'firebase:elif'");
  const today = Math.floor(Date.now() / DAY) * DAY;
  for (let i = 1; i < 30; i++) {
    const wave = Math.round(14 + 9 * Math.sin(i / 2.3) + i % 4);
    await run('INSERT OR REPLACE INTO visit_days (day, visitors, opens) VALUES (?, ?, ?)', today - i * DAY, wave, Math.round(wave * 1.8));
    await run('INSERT OR IGNORE INTO daily_stats (day, uploads, bytes, downloads, sign_ins, accounts) VALUES (?, ?, ?, ?, ?, ?)', today - i * DAY, i % 5, (i % 5) * 900_000, (i * 3) % 11, i % 7, i % 9 === 0 ? 1 : 0);
  }
}
await call('/none');
await seed();

http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (request.url === '/local/sign-in') {
    // Only the development site may ask. A website from the internet cannot.
    const own = request.headers.origin === SITE;
    response.writeHead(own ? 200 : 403, { 'content-type': 'application/json', ...(own ? { 'access-control-allow-origin': SITE, vary: 'Origin' } : {}) });
    response.end(JSON.stringify(own && request.method === 'POST' ? { token: await signIn(ADMIN) } : {}));
    return;
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const answer = await worker.fetch(new Request(API + request.url, { method: request.method, headers: request.headers, body }), env);
  response.writeHead(answer.status, Object.fromEntries(answer.headers));
  response.end(Buffer.from(await answer.arrayBuffer()));
}).listen(API_PORT, '127.0.0.1', () => {
  console.log(`Local test service on ${API}. Sign in on ${SITE}/#/login with “Local test admin”.`);
  const site = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(SITE_PORT)], { stdio: 'inherit', env: { ...process.env, VITE_SHARE_API_BASE: `http://127.0.0.1:${API_PORT}`, VITE_LOCAL_ADMIN: '1' } });
  site.on('exit', exit => process.exit(exit ?? 0));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { site.kill(); process.exit(0); });
});
