import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoredZip, normalizePackagePath, readZip } from '../src/services/zip.ts';

const encoder = new TextEncoder();

test('normalizes nested package paths and blocks traversal', () => {
  assert.equal(normalizePackagePath('scripts/main.js'), 'scripts/main.js');
  assert.equal(normalizePackagePath('images\\cover.webp'), 'images/cover.webp');
  for (const path of ['../secret.txt', '/rooted.txt', 'C:\\secret.txt', 'a/../b', 'a//b', 'a/./b']) {
    assert.throws(() => normalizePackagePath(path), /Unsafe project path/);
  }
});

test('writes and reads stored ZIP packages while preserving paths and bytes', async () => {
  const source = encoder.encode('<h1>Offline</h1>');
  const zip = createStoredZip([
    { path: 'index.html', data: source },
    { path: 'assets/note.txt', data: encoder.encode('local') },
  ]);
  const files = await readZip(new File([zip], 'project.zip', { type: 'application/zip' }));
  assert.deepEqual(files.map(file => file.path), ['index.html', 'assets/note.txt']);
  assert.equal(await files[0].blob.text(), '<h1>Offline</h1>');
  assert.equal(await files[1].blob.text(), 'local');
});

test('rejects case-colliding ZIP entries before import', async () => {
  const zip = createStoredZip([
    { path: 'assets/Cover.png', data: encoder.encode('first') },
    { path: 'assets/cover.png', data: encoder.encode('second') },
  ]);
  await assert.rejects(() => readZip(new File([zip], 'collision.zip')), /Duplicate or case-colliding/);
});

test('rejects ZIP contents whose CRC does not match', async () => {
  const zip = createStoredZip([{ path: 'index.html', data: encoder.encode('<p>ok</p>') }]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const central = bytes.findIndex((value, index) => value === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x01 && bytes[index + 3] === 0x02);
  assert.notEqual(central, -1);
  bytes[central + 16] ^= 0xff;
  await assert.rejects(() => readZip(new File([bytes], 'bad-crc.zip')), /integrity check/);
});
