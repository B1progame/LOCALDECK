import test from 'node:test';
import assert from 'node:assert/strict';
import { EXCERPT_CHARS, excerpt, smallDetails, tidySentence } from '../src/services/smallScan.ts';
import { loadBlobs } from '../src/localAi/parts.ts';

const page = more => ({ title: 'Vulkane', language: 'de', description: '', headings: ['Vulkane', 'Schildvulkane'], buttons: [], text: 'Vulkane entstehen dort, wo Magma aus dem Erdinneren aufsteigt. Schildvulkane haben flache Hänge. Der Vesuv zerstörte Pompeji.', kind: 'learning', ...more });
const options = ask => ({ filename: 'index.html', fallback: 'de', ask });

test('the answer of the small model is joined with the quick scan', async () => {
  const asked = [];
  const result = await smallDetails(page(), options(async messages => { asked.push(messages.at(-1).content); return asked.length === 1 ? '"Die Seite erklärt, wie Vulkane aus Magma entstehen."' : 'Wort8 = "Vulkane, Magma, Vesuv, Quantenphysik"'; }));
  assert.equal(result.suggestion.description, 'Die Seite erklärt, wie Vulkane aus Magma entstehen.');
  assert.deepEqual([result.suggestion.title, result.suggestion.type, result.quick, result.found], ['Vulkane', 'learning', undefined, null]);
  assert.ok(result.suggestion.tags.includes('Vesuv') && !result.suggestion.tags.includes('Quantenphysik'), result.suggestion.tags.join());
  assert.ok(result.suggestion.tags.length <= 10);
  // The same beginning, so it is read only once.
  const same = asked[0].lastIndexOf('"""');
  assert.equal(asked[0].slice(0, same), asked[1].slice(0, same));
});

test('useless answers leave the quick scan alone', async () => {
  const result = await smallDetails(page(), options(async () => 'Beschreibe in einem kurzen deutschen Satz, worum es geht?'));
  assert.equal(result.quick, true);
  assert.match(result.suggestion.description, /^Ein Lernzettel über/);
});

test('the description of the author stays, and then only the keywords are asked', async () => {
  let count = 0;
  const result = await smallDetails(page({ description: 'Alles über Vulkane.' }), options(async () => { count++; return 'Vulkane, Magma'; }));
  assert.deepEqual([count, result.suggestion.description], [1, 'Alles über Vulkane.']);
});

test('stopping ends it', async () => {
  await assert.rejects(smallDetails(page(), { ...options(async () => 'x'), cancelled: () => true }), /cancelled/);
});

test('a long project is cut to what fits', () => {
  const long = excerpt(page({ text: 'Anfang '.repeat(500) + 'Mitte '.repeat(500) }));
  assert.ok(long.length <= EXCERPT_CHARS, String(long.length));
  assert.match(long, /Anfang[\s\S]*Mitte/);
  assert.equal(excerpt(page({ title: '', headings: [], text: 'kurz' })), 'kurz');
});

test('sentences are cleaned, invented ones are dropped', () => {
  const text = 'Vulkane entstehen aus Magma.';
  assert.equal(tidySentence('<think>\n\n</think>\n**Vulkane** entstehen aus Magma.', 'Frage', text), 'Vulkane entstehen aus Magma.');
  assert.equal(tidySentence('A recipe for chocolate cookies with butter.', 'Frage', text), '');
  assert.equal(tidySentence('Vulkane.', 'Frage', text), '');
  assert.match(tidySentence('Vulkane entstehen aus Magma und das Magma der Vulkane', 'Frage', text), /…$/);
});

test('the model file is kept in parts and read without loading it again', async () => {
  const file = Uint8Array.from({ length: 25 }, (_, index) => index), data = new Map(), asked = [];
  const cache = { async match(key) { return data.get(String(key))?.clone(); }, async put(key, response) { data.set(String(key), response); } };
  const fetcher = async (url, init) => { const [, from, to] = init.headers.Range.match(/(\d+)-(\d+)/).map(Number); asked.push(from); return new Response(file.slice(from, to + 1), { status: 206, headers: { 'content-range': `bytes ${from}-${to}/25` } }); };
  const load = async more => new Uint8Array(await new Blob(await loadBlobs('https://models.example/a.gguf', { cache, fetcher, size: 10, ...more })).arrayBuffer());
  const progress = [];
  assert.deepEqual(await load({ onProgress: loaded => progress.push(loaded) }), file);
  assert.deepEqual([asked, progress], [[0, 10, 20], [10, 20, 25]]);
  assert.deepEqual(await load(), file);
  assert.equal(asked.length, 3);
  assert.deepEqual(await load({ cache: null }), file);
  const stop = new AbortController(); stop.abort();
  await assert.rejects(load({ signal: stop.signal }), /cancelled/);
});
