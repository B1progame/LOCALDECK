import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSharePackage, encryptSharePackage } from '../src/services/sharing.ts';

test('encrypted shares round trip without exposing archive bytes in the payload', async () => {
  const original = new TextEncoder().encode('LOCALDECK archive fixture');
  const encrypted = await encryptSharePackage(new Blob([original]));
  assert.equal(encrypted.payload.size, original.byteLength + 28);
  assert.match(encrypted.fragmentKey, /^[A-Za-z0-9_-]{43}$/);
  assert.notDeepEqual(new Uint8Array(await encrypted.payload.arrayBuffer()).slice(12), original);
  const restored = await decryptSharePackage(await encrypted.payload.arrayBuffer(), encrypted.fragmentKey);
  assert.deepEqual(new Uint8Array(restored), original);
});

test('encrypted shares reject altered payloads and malformed keys', async () => {
  const encrypted = await encryptSharePackage(new Blob(['private package']));
  const bytes = new Uint8Array(await encrypted.payload.arrayBuffer());
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(() => decryptSharePackage(bytes.buffer, encrypted.fragmentKey), /could not be decrypted/);
  await assert.rejects(() => decryptSharePackage(bytes.buffer, 'not-a-key'), /invalid encryption key/);
});

test('encrypted share creation rejects an empty archive', async () => {
  await assert.rejects(() => encryptSharePackage(new Blob([])), /archive is empty/);
});
