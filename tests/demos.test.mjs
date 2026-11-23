import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { analyzeFiles } from '../src/services/importer.ts';

const dir = new URL('../src/demos/', import.meta.url);

test('every demo project imports with its manifest and works offline', async () => {
  const files = (await readdir(dir)).filter(name => name.endsWith('.html'));
  assert.equal(files.length, 8);
  for (const name of files) {
    const html = await readFile(new URL(name, dir), 'utf8');
    const [preview] = await analyzeFiles([new File([html], name, { type: 'text/html' })]);
    assert.ok(preview.manifest, `${name} has an embedded manifest`);
    assert.notEqual(preview.type, 'other', `${name} declares a type`);
    assert.ok(preview.tags.includes('demo'), `${name} is tagged as a demo`);
    assert.ok(preview.description.length > 20, `${name} has a description`);
    assert.equal(preview.report.score, 'likely', `${name} has no remote or missing files: ${preview.report.findings.join(' ')}`);
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, `${name} loads nothing from the network`);
  }
});
