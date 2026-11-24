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
