import test from 'node:test';
import assert from 'node:assert/strict';

const memory = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, String(value)); }, removeItem: key => { data.delete(key); } }; };
Object.defineProperty(globalThis, 'localStorage', { value: memory(), configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: memory(), configurable: true });
globalThis.window = { setInterval: () => 0, clearInterval() {}, addEventListener() {}, removeEventListener() {} };
globalThis.document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} };
const S = await import('../src/services/session.ts');

const now = () => Math.floor(Date.now() / 1000);
const token = (exp, mark = 'x') => `h.${Buffer.from(JSON.stringify({ exp, mark })).toString('base64url')}.s`;
const person = { email: 'a@example.com', name: 'A', picture: '' };
let answers = [], asked = [];
globalThis.fetch = async (url, init) => { asked.push([String(url), init]); const next = answers.shift(); if (next === 'offline') throw new TypeError('offline'); return Response.json(next.body, { status: next.status ?? 200 }); };
const reset = () => { asked = []; answers = []; S.signOutHere(); S.setStaySignedIn(true); };
S.keepSignedIn('key');

test('a sign-in survives the browser, or only the tab when the person wants that', () => {
  reset();
  S.saveShareSession({ token: token(now() + 3600), refresh: 'r1' }, person);
  assert.ok(localStorage.data.get('localdeck-session').includes('r1'));
  assert.equal(sessionStorage.data.has('localdeck-session'), false);
  S.setStaySignedIn(false);
  S.saveShareSession({ token: token(now() + 3600), refresh: 'r2' }, person);
  assert.equal(localStorage.data.has('localdeck-session'), false);
  assert.ok(sessionStorage.data.get('localdeck-session').includes('r2'));
  S.signOutHere();
  assert.equal(sessionStorage.data.has('localdeck-session'), false);
  assert.equal(S.getShareSession(), null);
});

test('a token that ends soon is renewed once, also for many requests at the same time', async () => {
  reset();
  S.saveShareSession({ token: token(now() + 60, 'old'), refresh: 'r1' }, person);
  const fresh = token(now() + 3600, 'new');
  answers = [{ body: { id_token: fresh, refresh_token: 'r2' } }];
  assert.deepEqual(await Promise.all([S.freshToken(), S.freshToken(), S.freshToken()]), [fresh, fresh, fresh]);
  assert.equal(asked.length, 1);
  assert.match(asked[0][0], /^https:\/\/securetoken\.googleapis\.com\/v1\/token\?key=key$/);
  assert.equal(String(asked[0][1].body), 'grant_type=refresh_token&refresh_token=r1');
  assert.equal(S.getShareSession().refresh, 'r2');
  assert.equal(S.getShareSession().email, 'a@example.com');
  assert.equal(await S.freshToken(), fresh);
  assert.equal(asked.length, 1);
});

test('nobody is signed out because the hour is over or the internet is gone', async () => {
  reset();
  S.saveShareSession({ token: token(now() - 7200), refresh: 'r1' }, person);
  assert.equal(S.getShareSession().email, 'a@example.com');
  answers = ['offline'];
  assert.equal(await S.freshToken(), null);
  assert.equal(S.getShareSession().email, 'a@example.com');
  answers = [{ status: 503, body: { error: { message: 'UNAVAILABLE' } } }];
  assert.equal(await S.freshToken(), null);
  assert.ok(S.getShareSession());
  answers = [{ body: { id_token: token(now() + 3600), refresh_token: 'r1' } }];
  assert.ok(await S.freshToken());
});

test('a deleted or disabled account is signed out', async () => {
  for (const message of ['USER_NOT_FOUND', 'USER_DISABLED', 'TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN']) {
    reset();
    S.saveShareSession({ token: token(now() + 10), refresh: 'r1' }, person);
    answers = [{ status: 400, body: { error: { message } } }];
    assert.equal(await S.freshToken(), null, message);
    assert.deepEqual([S.getShareSession(), S.useSession.getState().ended, localStorage.data.has('localdeck-session')], [null, true, false]);
  }
});

test('signing out while a renewal is on its way stays signed out', async () => {
  reset();
  S.saveShareSession({ token: token(now() + 10), refresh: 'r1' }, person);
  let go; const wait = new Promise(resolve => { go = resolve; });
  const before = globalThis.fetch;
  globalThis.fetch = async () => { await wait; return Response.json({ id_token: token(now() + 3600), refresh_token: 'r2' }); };
  const running = S.freshToken();
  S.signOutHere();
  go();
  assert.equal(await running, null);
  assert.equal(S.getShareSession(), null);
  globalThis.fetch = before;
});

test('a refused request is repeated once with a renewed sign-in', async () => {
  reset();
  const fresh = token(now() + 3600, 'new');
  S.saveShareSession({ token: token(now() + 3000, 'old'), refresh: 'r1' }, person);
  answers = [{ status: 401, body: {} }, { body: { id_token: fresh, refresh_token: 'r1' } }, { body: { ok: true } }];
  const response = await S.authFetch('https://api.example/x', { method: 'PUT', headers: { 'content-type': 'application/json' } });
  assert.equal(response.status, 200);
  assert.deepEqual([asked[2][1].method, asked[2][1].headers.Authorization, asked[2][1].headers['content-type']], ['PUT', `Bearer ${fresh}`, 'application/json']);
  answers = [{ status: 401, body: {} }, { body: { id_token: fresh, refresh_token: 'r1' } }];
  asked = [];
  assert.equal((await S.authFetch('https://api.example/x')).status, 401);
  assert.equal(asked.length, 2);
});

test('a sign-in without renewal ends with its token, and broken storage signs nobody in', () => {
  reset();
  S.saveShareSession({ token: token(now() + 5) }, person);
  assert.equal(S.getShareSession(), null);
  assert.throws(() => S.tokenEnd('nonsense'));
});
