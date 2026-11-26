import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { planFrame } from '../src/services/frameSource.ts';

test('HTML is always sandboxed, with or without the service worker', () => {
  const withoutWorker = planFrame('index.html', ['index.html'], false);
  assert.equal(withoutWorker.kind, 'packed');
  assert.match(withoutWorker.sandbox, /allow-scripts/);
  assert.doesNotMatch(withoutWorker.sandbox, /allow-same-origin/);
  assert.equal(planFrame('index.html', ['index.html'], true).kind, 'packed');
  assert.doesNotMatch(planFrame('index.html', ['index.html'], true).sandbox, /allow-same-origin/);
});

test('only real PDF paths skip the sandbox, and they are forced to the PDF type', () => {
  assert.deepEqual(planFrame('notes.pdf', ['notes.pdf'], false), { kind: 'blob', mime: 'application/pdf', sandbox: undefined });
  for (const path of ['evil.svg', 'evil.xml', 'evil.xhtml', 'evil.txt', 'pdf']) assert.equal(planFrame(path, [path], false).kind, 'unavailable', path);
});

test('multi-file pages run without the service worker, too', () => {
  assert.equal(planFrame('index.html', ['index.html', 'app.js'], false).kind, 'packed');
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

const { RUNTIME, runtimeScript, projectPolicy } = await import('../src/services/playerRuntime.ts');

function runtime(saved = { local: {}, cookies: '' }, named = {}, folder = '') {
  const sent = [], timers = [], listeners = {};
  class Base { constructor() { this.attributes = {}; } }
  const setter = () => ({ get() { return this.value; }, set(value) { this.value = value; }, configurable: true, enumerable: true });
  const element = name => { const Type = class extends Base {}; Object.defineProperty(Type.prototype, name === 'HTMLLinkElement' ? 'href' : 'src', setter()); return Type; };
  const context = vm.createContext({ Proxy, Object, String, JSON, Date, Array, DOMException, Promise,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => undefined,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    parent: { postMessage: message => sent.push(JSON.parse(JSON.stringify(message))) },
    fetch: async url => ({ url }), XMLHttpRequest: class { open(method, url) { this.url = url; } },
    Element: class { setAttribute(name, value) { this[name] = value; } },
    HTMLImageElement: element('HTMLImageElement'), HTMLMediaElement: element('HTMLMediaElement'), HTMLScriptElement: element('HTMLScriptElement'), HTMLSourceElement: element('HTMLSourceElement'), HTMLLinkElement: element('HTMLLinkElement'),
    Audio: class { constructor(src) { this.src = src; } }, Worker: class { constructor(url) { this.url = url; } },
  });
  context.window = context;
  context.document = { addEventListener: (type, fn) => { listeners['document:' + type] = fn; } };
  vm.runInContext(runtimeScript(saved, 'tok-1', named, folder), context);
  return { context, sent, timers, listeners, run: code => vm.runInContext(code, context) };
}

test('projects keep localStorage and cookies through the player', () => {
  const { run, sent, timers } = runtime({ local: { best: '3' }, cookies: 'a=1' });
  run('localStorage.setItem("best", 12); localStorage.name = "Ada"; sessionStorage.setItem("x", "1"); document.cookie = "level=4; path=/"; document.cookie = "a=; max-age=0";');
  assert.equal(run('JSON.stringify([localStorage.getItem("best"), localStorage.length, localStorage.key(1), "name" in localStorage, localStorage.missing, sessionStorage.x, document.cookie])'), JSON.stringify(['12', 2, 'name', true, null, '1', 'level=4']));
  timers.at(-1)();
  assert.deepEqual(sent.at(-1), { local: { best: '12', name: 'Ada' }, cookies: 'level=4', localdeck: 'save', token: 'tok-1' });
  assert.throws(() => run('localStorage.setItem("big", "x".repeat(3 * 1024 * 1024))'), /full/);
  assert.equal(run('localStorage.getItem("big")'), null);
});

test('files that scripts load by name come from the project, also from the root', async () => {
  const named = { 'img/hero.png': 'data:image/png;base64,AA==', 'data/levels.json': 'data:application/json,[1]', 'music.mp3': 'data:audio/mpeg;base64,AA==' };
  const { run } = runtime(undefined, named, 'pages');
  assert.equal(run('var i = new HTMLImageElement(); i.src = "../img/hero.png"; i.src'), named['img/hero.png']);
  assert.equal(run('(new Audio("/music.mp3")).src'), named['music.mp3']);
  assert.equal((await run('fetch("/data/levels.json?v=2")')).url, named['data/levels.json']);
  assert.equal(run('var x = new XMLHttpRequest(); x.open("GET", "../data/levels.json"); x.url'), named['data/levels.json']);
  assert.equal(run('var s = new HTMLScriptElement(); s.src = "https://cdn.example/x.js"; s.src'), 'https://cdn.example/x.js');
});

test('a link to another page asks the player to open it', () => {
  const { listeners, sent } = runtime();
  let prevented = false;
  const link = { target: '', getAttribute: () => 'more/page2.html#top' };
  listeners['document:click']({ target: { closest: () => link }, defaultPrevented: false, preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.deepEqual(sent.at(-1), { localdeck: 'open', path: 'more/page2.html', hash: '#top', token: 'tok-1' });
  listeners['document:click']({ target: { closest: () => ({ target: '', getAttribute: () => 'https://example.com' }) }, defaultPrevented: false, preventDefault: () => { throw new Error('must not stop links to websites'); } });
});

test('the page of a project can only reach the internet when the person allowed it', () => {
  const closed = projectPolicy(false), open = projectPolicy(true);
  assert.doesNotMatch(closed, /https:|wss:/);
  assert.match(closed, /^default-src 'none'/);
  assert.match(open, /connect-src data: blob: https: wss:/);
  assert.doesNotMatch(RUNTIME, /<\/script/i);
  assert.doesNotMatch(runtimeScript({ local: { a: '</script><script>alert(1)</script>' }, cookies: '' }, 't', {}, ''), /<\/script/i);
});
