import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { planFrame } from '../src/services/frameSource.ts';

test('HTML is always sandboxed, with or without the service worker', () => {
  const withoutWorker = planFrame('index.html', ['index.html'], false);
  assert.equal(withoutWorker.kind, 'blob');
  assert.match(withoutWorker.sandbox, /allow-scripts/);
  assert.doesNotMatch(withoutWorker.sandbox, /allow-same-origin/);
  assert.equal(planFrame('index.html', ['index.html'], true).kind, 'routed');
  assert.ok(planFrame('index.html', ['index.html'], true).sandbox);
});

test('only real PDF paths skip the sandbox, and they are forced to the PDF type', () => {
  assert.deepEqual(planFrame('notes.pdf', ['notes.pdf'], false), { kind: 'blob', mime: 'application/pdf', sandbox: undefined });
  for (const path of ['evil.svg', 'evil.xml', 'evil.xhtml', 'evil.txt', 'pdf']) assert.equal(planFrame(path, [path], false).kind, 'unavailable', path);
});

test('multi-file pages wait for the service worker', () => {
  assert.equal(planFrame('index.html', ['index.html', 'app.js'], false).kind, 'unavailable');
});

/** The service worker with a small in-memory IndexedDB: one database per name, stores as maps. */
async function worker({ items = {}, assets = {}, clients = {} } = {}) {
  const listeners = {}, dbs = new Map();
  const request = (run) => { const r = {}; queueMicrotask(() => { try { r.result = run(); r.onsuccess?.(); } catch (error) { r.error = error; r.onerror?.(); } }); return r; };
  const open = name => {
    if (!dbs.has(name)) dbs.set(name, name === 'localdeck-library-v2' ? { items: new Map(Object.entries(items)), assets: new Map(Object.entries(assets)) } : {});
    const stores = dbs.get(name);
    const db = { objectStoreNames: { contains: store => store in stores }, close() {}, createObjectStore: store => { stores[store] = new Map(); },
      transaction: () => { const tx = { objectStore: store => ({ get: key => request(() => stores[store].get(key)), put: value => { stores[store].set(value.id, value); queueMicrotask(() => tx.oncomplete?.()); }, delete: key => stores[store].delete(key), index: () => ({ get: ([item, path]) => request(() => stores.assets.get(`${item}/${path}`)) }) }) }; return tx; } };
    const r = {}; queueMicrotask(() => { if (!Object.keys(stores).length && name !== 'localdeck-library-v2') { r.result = db; r.onupgradeneeded?.(); } r.result = db; r.onsuccess?.(); }); return r;
  };
  const context = vm.createContext({ URL, Headers, Response, Blob, TextEncoder, TextDecoder, caches: {}, fetch: () => { throw new Error('network'); }, indexedDB: { open },
    self: { location: { href: 'https://app.example/LOCALDECK/sw.js', origin: 'https://app.example' }, addEventListener: (type, fn) => { listeners[type] = fn; }, clients: { get: async id => clients[id] ?? null } } });
  vm.runInContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  const fetch = (url, init = {}) => { let response; listeners.fetch({ request: new Request(url, init), clientId: init.clientId ?? '', respondWith: value => { response = value; } }); return response; };
  return { fetch, dbs };
}

async function serve(path, mimeType) {
  const { fetch } = await worker({ assets: { [`item-1/${path}`]: { blob: new Blob(['x']), mimeType } } });
  return fetch(`https://app.example/LOCALDECK/__localdeck_asset/item-1/${path}`, { mode: 'same-origin' });
}

test('the service worker sandboxes every project file except PDFs', async () => {
  for (const [path, type] of [['index.html', 'text/html'], ['evil.svg', 'image/svg+xml'], ['evil.xml', 'application/xml'], ['evil.png', 'text/html'], ['app.js', 'text/javascript']]) {
    const response = await serve(path, type);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('Content-Security-Policy') ?? '', /^sandbox allow-scripts/, path);
    assert.doesNotMatch(response.headers.get('Content-Security-Policy').split(';')[0], /allow-same-origin/, path);
  }
  assert.equal((await serve('notes.pdf', 'application/pdf')).headers.get('Content-Security-Policy'), null);
});

test('a page that is made to be slow does not stop the app or the service', async () => {
  const { diagnoseCompatibility } = await import('../src/services/importer.ts');
  const { checkContent } = await import('../src/services/contentCheck.ts');
  const { checkProject } = await import('../cloudflare/worker/src/guide.ts');
  const fast = (name, run) => { const start = performance.now(); run(); assert.ok(performance.now() - start < 2500, `${name}: ${Math.round(performance.now() - start)} ms`); };
  const fill = (unit, bytes) => unit.repeat(Math.floor(bytes / unit.length));
  for (const unit of ['url( ', 'url(', 'url("', "url('a", 'src="', '@import "', '<script id="localdeck-manifest" type="application/json"', '<script id="localdeck-manifest" type="application/json">']) fast(unit, () => diagnoseCompatibility(fill(unit, 600_000)));
  fast('password', () => checkContent({ top: '', text: '', source: fill('<input ', 3_000_000) }));
  for (const unit of ['<img ', '<meta ', '<html ', '<input ', '<img src="x">', '<img src="/x">\n']) fast(unit, () => checkProject(new Map([['index.html', new TextEncoder().encode(fill(unit, 200_000))]])));
});

test('what the checks find stays the same', async () => {
  const { diagnoseCompatibility } = await import('../src/services/importer.ts');
  const { checkProject } = await import('../cloudflare/worker/src/guide.ts');
  const report = diagnoseCompatibility('<style>a{background:url(one.png)} b{background:url( "two.png" )} c{background:url(\'three.png\')} d{background:url(https://x.example/y.png)}</style>', ['index.html', 'one.png'], 'index.html').findings.join(' ');
  assert.match(report, /1 remote file reference detected/);
  assert.match(report, /two\.png/); assert.match(report, /three\.png/); assert.doesNotMatch(report, /one\.png/);
  const found = checkProject(new Map([['index.html', new TextEncoder().encode('<!doctype html><html lang="de"><img alt="a" src="https://x.example/a.png"><input type="password"><script src="missing.js"></script>')]])).join('\n');
  for (const part of [/internet/, /password/, /"missing\.js" is not in the project/, /viewport/]) assert.match(found, part);
});

test('the code of the admin page is not loaded by everyone', async () => {
  const main = await readFile('src/main.tsx', 'utf8'), config = await readFile('vite.config.ts', 'utf8');
  assert.doesNotMatch(main, /^import \{ AdminPage \}/m);
  assert.match(main, /lazy\(\(\) => import\('\.\/adminPage'\)/);
  assert.match(config, /onDemand = .*adminPage/);
});

const ASSET = 'https://app.example/LOCALDECK/__localdeck_asset/';
const page = { blob: new Blob(['<!DOCTYPE html><html><head><title>Ä</title></head><body><script>localStorage.setItem("best", 7)</script></body></html>']), mimeType: 'text/html' };

test('a project gets its own storage, and only its own pages can change it', async () => {
  const sw = await worker({ items: { 'game-1': { runtimeSettings: {} } }, assets: { 'game-1/index.html': page, 'game-1/app.js': { blob: new Blob(['x']), mimeType: 'text/javascript' } }, clients: { a: { url: `${ASSET}game-1/index.html` }, b: { url: `${ASSET}other-2/index.html` } } });
  const html = await (await sw.fetch(`${ASSET}game-1/index.html`)).text();
  assert.ok(html.startsWith('<!DOCTYPE html><script>(function (saved, endpoint, limit)'), html.slice(0, 80));
  assert.match(html, /<title>Ä<\/title>/);
  assert.equal(await (await sw.fetch(`${ASSET}game-1/app.js`)).text(), 'x');
  const save = (client, body) => sw.fetch(`${ASSET}game-1/__localdeck_save`, { method: 'POST', body: JSON.stringify(body), clientId: client });
  assert.equal((await save('b', { local: { best: '99' } })).status, 403);
  assert.equal((await save('', { local: { best: '99' } })).status, 403);
  assert.equal((await save('a', { local: { best: 3 } })).status, 400);
  assert.equal((await save('a', { local: { best: '7', name: '</script><script>alert(1)</script>' }, cookies: 'level=3' })).status, 204);
  const again = await (await sw.fetch(`${ASSET}game-1/index.html`)).text();
  assert.match(again, /"best":"7"/);
  assert.match(again, /level=3/);
  assert.doesNotMatch(again.slice(0, again.indexOf('</script>') + 9), /<\/script><script>alert/);
  assert.equal((await sw.fetch(`${ASSET}game-1/__localdeck_save`, { method: 'POST', body: 'x'.repeat(5 * 1024 * 1024 + 1), clientId: 'a' })).status, 413);
});

test('the replacement storage behaves like the real one', async () => {
  const sw = await worker({ items: { 'g-1': { runtimeSettings: {} } }, assets: { 'g-1/index.html': page } });
  const html = await (await sw.fetch(`${ASSET}g-1/index.html`)).text();
  const code = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  const sent = [], timers = [], page_ = {};
  const context = vm.createContext({ Proxy, Object, String, JSON, Date, DOMException, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => undefined, addEventListener: () => undefined, fetch: (url, init) => { sent.push([url, JSON.parse(init.body)]); } });
  context.window = context; context.document = page_;
  vm.runInContext(code, context);
  vm.runInContext('localStorage.setItem("best", 12); localStorage.name = "Ada"; sessionStorage.setItem("x", "1"); document.cookie = "level=4; path=/"; document.cookie = "old=1"; document.cookie = "old=; max-age=0";', context);
  assert.equal(vm.runInContext('JSON.stringify([localStorage.getItem("best"), localStorage.length, localStorage.key(0), "name" in localStorage, localStorage.missing, document.cookie])', context), JSON.stringify(['12', 2, 'best', true, null, 'level=4']));
  timers.at(-1)();
  assert.equal(sent.at(-1)[0], `${ASSET}g-1/__localdeck_save`);
  assert.deepEqual(sent.at(-1)[1], { local: { best: '12', name: 'Ada' }, cookies: 'level=4' });
  assert.throws(() => vm.runInContext('localStorage.setItem("big", "x".repeat(3 * 1024 * 1024))', context), /full/);
  assert.equal(vm.runInContext('localStorage.getItem("big")', context), null);
});

test('the internet is only open for projects that the person allowed', async () => {
  const policy = async (internet) => {
    const sw = await worker({ items: { 'p-1': { runtimeSettings: { internet } } }, assets: { 'p-1/index.html': page } });
    return (await sw.fetch(`${ASSET}p-1/index.html`)).headers.get('Content-Security-Policy');
  };
  const closed = await policy(false), open = await policy(true);
  assert.ok(!closed.includes(' https: '), closed);
  assert.match(closed, /^sandbox allow-scripts[^;]*allow-modals/);
  assert.match(open, /connect-src https:\/\/app\.example https: blob: wss:/);
  assert.match(open, /script-src https:\/\/app\.example https: 'unsafe-inline'/);
  assert.doesNotMatch(open.split(';')[0], /allow-same-origin/);
});

test('a path from the root means a file of the project', async () => {
  const sw = await worker({ assets: { 'p-1/css/style.css': { blob: new Blob(['body{}']), mimeType: 'text/css' } }, clients: { a: { url: `${ASSET}p-1/index.html` }, app: { url: 'https://app.example/LOCALDECK/' } } });
  const response = await sw.fetch('https://app.example/css/style.css', { clientId: 'a' });
  assert.equal(await response.text(), 'body{}');
  assert.match(response.headers.get('Content-Security-Policy'), /^sandbox/);
});
