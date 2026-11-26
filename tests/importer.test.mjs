import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeFiles, diagnoseCompatibility, isJunkPath } from '../src/services/importer.ts';
import { createStoredZip } from '../src/services/zip.ts';

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
  // The fixture only uses packaged files, so nothing should be flagged.
  assert.equal(preview.report.score, 'likely');
});


test('flags remote resources and network calls as partial compatibility', () => {
  assert.equal(diagnoseCompatibility('<script src="https://cdn.example.com/lib.js"></script>', ['index.html']).score, 'partial');
  assert.equal(diagnoseCompatibility('<script>fetch("/api")</script>', ['index.html']).score, 'partial');
  assert.equal(diagnoseCompatibility('<h1>Offline</h1>', ['index.html']).score, 'likely');
});

test('only what a page really loads counts, not text in scripts or links to websites', () => {
  const ok = html => assert.equal(diagnoseCompatibility(html, ['index.html', 'data.json', 'style.css']).score, 'likely', html);
  const flagged = html => assert.equal(diagnoseCompatibility(html, ['index.html', 'data.json', 'style.css']).score, 'partial', html);
  ok('<script>const data = "hallo welt"; el.href = "#top"; img.src = "player.png";</script>');
  ok('<a href="https://example.com">Seite</a><a href="/">Start</a><a href="mailto:a@b.c">Mail</a>');
  ok('<link rel="canonical" href="https://x.example/"><link rel="preconnect" href="https://fonts.gstatic.com"><meta property="og:url" content="https://x.example">');
  ok('<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/></svg><div data-x="y"></div>');
  ok('<link rel="stylesheet" href="/style.css"><script>fetch("data.json"); fetch(`./data.json`)</script>');
  flagged('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">');
  flagged('<script>fetch("https://api.example.com/x")</script>');
  flagged('<script>const socket = new WebSocket("wss://x.example")</script>');
  flagged('<script src="missing.js"></script>');
  flagged('<a href="page2.html">Weiter</a>');
});

test('ignores macOS metadata and version-control folders in packages', async () => {
  const enc = new TextEncoder();
  const zip = createStoredZip([
    { path: 'project/index.html', data: enc.encode('<h1>Hi</h1>') },
    { path: 'project/localdeck.json', data: enc.encode(JSON.stringify({ schemaVersion: 1, title: 'From manifest', type: 'game' })) },
    { path: '__MACOSX/project/._index.html', data: enc.encode('junk') },
    { path: 'project/.DS_Store', data: enc.encode('junk') },
  ]);
  const [preview] = await analyzeFiles([new File([zip], 'mac.zip', { type: 'application/zip' })]);
  assert.equal(preview.title, 'From manifest');
  assert.equal(preview.type, 'game');
  assert.deepEqual(preview.files.map(file => file.path).sort(), ['index.html', 'localdeck.json']);
  assert.equal(isJunkPath('site/.git/config'), true);
  assert.equal(isJunkPath('site/index.html'), false);
});
