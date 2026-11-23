import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeFiles } from '../src/services/importer.ts';

test('imports standalone HTML metadata without executing project code', async () => {
  const html = new File(['<script>globalThis.shouldNotRun = true</script><h1>Notes</h1>'], 'notes.html', { type: 'text/html' });
  const [preview] = await analyzeFiles([html]);
  assert.equal(preview.title, 'notes');
  assert.equal(preview.selectedEntry, 'notes.html');
  assert.equal(preview.files.length, 1);
  assert.equal(globalThis.shouldNotRun, undefined);
});

test('imports PDF documents only after checking their signature', async () => {
  const valid = new File(['%PDF-1.7\nnot a full document'], 'guide.pdf', { type: 'application/pdf' });
  const [preview] = await analyzeFiles([valid]);
  assert.equal(preview.type, 'document');
  assert.equal(preview.selectedEntry, 'guide.pdf');
  await assert.rejects(() => analyzeFiles([new File(['not pdf'], 'broken.pdf')]), /does not look like a valid PDF/);
});

test('preserves folder-relative assets and flags missing project entry points', async () => {
  const html = new File(['<img src="images/cover.png">'], 'main.html', { type: 'text/html' });
  Object.defineProperty(html, 'webkitRelativePath', { value: 'course/main.html' });
  const asset = new File(['cover'], 'cover.png', { type: 'image/png' });
  Object.defineProperty(asset, 'webkitRelativePath', { value: 'course/images/cover.png' });
  const [preview] = await analyzeFiles([html, asset]);
  assert.deepEqual(preview.files.map(file => file.path).sort(), ['images/cover.png', 'main.html']);
  assert.equal(preview.selectedEntry, 'main.html');
});

test('keeps independent HTML selections as separate import previews', async () => {
  const previews = await analyzeFiles([
    new File(['<h1>One</h1>'], 'one.html', { type: 'text/html' }),
    new File(['<h1>Two</h1>'], 'two.html', { type: 'text/html' }),
  ]);
  assert.deepEqual(previews.map(preview => preview.title), ['one', 'two']);
});

test('analyzes a real multi-file runtime fixture while preserving relative assets', async () => {
  const archive = new File([await readFile(new URL('./fixtures/runtime-project.zip', import.meta.url))], 'runtime-project.zip', { type: 'application/zip' });
  const [preview] = await analyzeFiles([archive]);
  assert.equal(preview.selectedEntry, 'index.html');
  assert.deepEqual(preview.files.map(file => file.path).sort(), ['index.html', 'scripts/main.js', 'styles/main.css']);
  assert.equal(preview.report.score, 'partial');
});
