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

async function serve(path, mimeType) {
  const listeners = {};
  const record = { blob: new Blob(['x']), mimeType };
  const request = (result) => { const r = {}; queueMicrotask(() => { r.result = result; r.onsuccess?.(); }); return r; };
  const db = { objectStoreNames: { contains: () => true }, close() {}, transaction: () => ({ objectStore: () => ({ index: () => ({ get: () => request(record) }) }) }) };
  const context = vm.createContext({ URL, Headers, Response, Blob, caches: {}, fetch: () => { throw new Error('network'); }, indexedDB: { open: () => request(db) },
    self: { location: { href: 'https://app.example/LOCALDECK/sw.js', origin: 'https://app.example' }, addEventListener: (type, fn) => { listeners[type] = fn; } } });
  vm.runInContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  let response;
  listeners.fetch({ request: { method: 'GET', mode: 'navigate', url: `https://app.example/LOCALDECK/__localdeck_asset/item-1/${path}` }, respondWith: value => { response = value; } });
  return response;
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
