const DEFAULT_LIMIT_MIB = 24;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('The share link has an invalid encryption key.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '=';
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  if (bytes.byteLength !== KEY_BYTES) throw new Error('The share link has an invalid encryption key.');
  return bytes;
}

export async function encryptSharePackage(archive: Blob, limitMiB = DEFAULT_LIMIT_MIB): Promise<{ payload: Blob; fragmentKey: string }> {
  if (archive.size < 1) throw new Error('The project archive is empty.');
  if (archive.size + IV_BYTES + TAG_BYTES > limitMiB * 1024 * 1024) throw new Error(`This project is larger than your limit of ${limitMiB} MiB per link.`);
  if (!crypto.subtle) throw new Error('This browser does not support secure project encryption. Open LocalDeck over HTTPS or localhost.');
  const key = await crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, true, ['encrypt']);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, await archive.arrayBuffer());
  return { payload:new Blob([iv, new Uint8Array(ciphertext)], { type:'application/octet-stream' }), fragmentKey:toBase64Url(rawKey) };
}

export async function decryptSharePackage(payload: ArrayBuffer, fragmentKey: string): Promise<ArrayBuffer> {
  if (!crypto.subtle) throw new Error('This browser does not support secure project decryption.');
  if (payload.byteLength < IV_BYTES + TAG_BYTES) throw new Error('The encrypted package is incomplete.');
  const bytes = new Uint8Array(payload);
  const rawKey = new ArrayBuffer(KEY_BYTES);
  new Uint8Array(rawKey).set(fromBase64Url(fragmentKey));
  const key = await crypto.subtle.importKey('raw', rawKey, { name:'AES-GCM' }, false, ['decrypt']);
  try {
    return await crypto.subtle.decrypt({ name:'AES-GCM', iv:bytes.slice(0,IV_BYTES) }, key, bytes.slice(IV_BYTES));
  } catch {
    throw new Error('This share could not be decrypted. Check that the complete link is intact.');
  }
}

