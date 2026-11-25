import test from 'node:test';
import assert from 'node:assert/strict';
import { loadInParts, storedShare } from '../src/localAi/parts.ts';

const URL_ = 'https://models.example/model.onnx_data', SIZE = 10;
const file = Uint8Array.from({ length: 47 }, (_, index) => index);
const cache = () => { const data = new Map(); return { data, async match(key) { return data.get(String(key))?.clone(); }, async put(key, response) { data.set(String(key), response); }, async keys() { return [...data.keys()].map(url => ({ url })); } }; };
const server = (fail = () => false) => { const asked = []; return { asked, fetcher: async (url, init) => { const [, from, to] = init.headers.Range.match(/(\d+)-(\d+)/).map(Number); asked.push(from); if (fail(asked.length, from)) throw new TypeError('network lost'); return new Response(file.slice(from, to + 1), { status: 206, headers: { 'content-range': `bytes ${from}-${Math.min(to, 46)}/47` } }); } }; };
const options = (store, source) => ({ cache: store, fetcher: source.fetcher, wait: async () => undefined, size: SIZE });
const read = async response => new Uint8Array(await response.arrayBuffer());

test('a file in parts looks like a normal download', async () => {
  const store = cache(), source = server();
  const response = await loadInParts(URL_, options(store, source));
  assert.deepEqual([response.status, response.headers.get('content-length')], [200, '47']);
  assert.deepEqual(await read(response), file);
  assert.deepEqual(source.asked, [0, 10, 20, 30, 40]);
  assert.equal(await storedShare(store, SIZE), 1);
});

test('the second time nothing is loaded', async () => {
  const store = cache();
  await read(await loadInParts(URL_, options(store, server())));
  const again = server(() => true);
  assert.deepEqual(await read(await loadInParts(URL_, options(store, again))), file);
  assert.deepEqual(again.asked, []);
});

test('after a lost connection it continues where it stopped', async () => {
  const store = cache(), broken = server((count, from) => from >= 30);
  await assert.rejects(read(await loadInParts(URL_, options(store, broken))), /network lost/);
  assert.equal(await storedShare(store, SIZE), 3 / 5);
  const rest = server();
  assert.deepEqual(await read(await loadInParts(URL_, options(store, rest))), file);
  assert.deepEqual(rest.asked, [30, 40]);
});

test('a short interruption is bridged, a damaged part is loaded again', async () => {
  const store = cache(), shaky = server(count => count === 2 || count === 4);
  assert.deepEqual(await read(await loadInParts(URL_, options(store, shaky))), file);
  store.data.set(`${URL_}?localdeck-part=1`, new Response(new Uint8Array(3)));
  const source = server();
  assert.deepEqual(await read(await loadInParts(URL_, options(store, source))), file);
  assert.deepEqual(source.asked, [10]);
});

test('several large files count together', async () => {
  const store = cache();
  await read(await loadInParts(URL_, options(store, server())));
  await assert.rejects(read(await loadInParts('https://models.example/two.onnx_data', options(store, server((count, from) => from >= 10)))));
  assert.equal(await storedShare(store, SIZE), 6 / 10);
});

test('it also works without storage, and refuses servers that ignore the range', async () => {
  assert.deepEqual(await read(await loadInParts(URL_, options(null, server()))), file);
  const full = { fetcher: async () => new Response(file, { status: 200 }) };
  await assert.rejects(loadInParts(URL_, options(cache(), full)), /http 200/);
  const whole = cache();
  await whole.put(URL_, new Response(file));
  assert.equal(await storedShare(whole, SIZE), 1);
  assert.equal(await storedShare(cache(), SIZE), 0);
});
