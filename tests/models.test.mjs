import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_IDS, MODELS } from '../src/localAi/model.ts';

test('every model has a fixed version, its own storage and a license that allows passing it on', () => {
  const caches = new Set();
  for (const id of MODEL_IDS) {
    const model = MODELS[id];
    assert.equal(model.id, id);
    assert.match(model.revision, /^[0-9a-f]{40}$/);
    assert.equal(model.license, 'Apache 2.0');
    assert.ok(model.bytes > 100e6 && model.page.startsWith('https://huggingface.co/'));
    if (model.runs === 'cpu') assert.ok(model.url.includes(`/resolve/${model.revision}/`) && model.url.endsWith('.gguf'), id);
    caches.add(model.cache);
  }
  assert.equal(caches.size, MODEL_IDS.length);
  assert.ok(MODEL_IDS.some(id => MODELS[id].runs === 'cpu') && MODEL_IDS.some(id => MODELS[id].runs === 'gpu'));
});
