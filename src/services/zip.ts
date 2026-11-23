export interface ZipEntry { path: string; blob: Blob; }

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export const ZIP_LIMITS = {
  maxArchiveBytes: 140 * 1024 * 1024,
  maxProjectArchiveBytes: 80 * 1024 * 1024,
  maxExpandedBytes: 120 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
  maxEntries: 3000,
  maxCompressionRatio: 200,
};

export function normalizePackagePath(input: string): string {
  const value = input.replace(/\\/g, '/');
  if (!value || value.includes('\0') || value.startsWith('/') || /^[a-zA-Z]:/.test(value) || value.startsWith('//')) {
    throw new Error(`Unsafe project path: ${input}`);
  }
  const parts = value.split('/');
  if (parts.some(part => part === '..' || part === '.' || part === '')) throw new Error(`Unsafe project path: ${input}`);
  return parts.join('/');
}

function assertRange(offset: number, length: number, total: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > total) {
    throw new Error('This ZIP package contains an invalid file directory.');
  }
}

async function inflate(method: number, data: Uint8Array, expected: number): Promise<Uint8Array> {
  if (method === 0) {
    if (data.length !== expected) throw new Error('A stored ZIP file has an invalid size.');
    return data;
  }
  if (method !== 8) throw new Error(`ZIP compression method ${method} is not supported.`);
  if (!('DecompressionStream' in globalThis)) throw new Error('This browser cannot open compressed ZIP files; use a current version of Chrome, Edge, Firefox, or Safari.');
  try {
    const stream = new Blob([toArrayBuffer(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > expected || size > ZIP_LIMITS.maxFileBytes) {
        await reader.cancel();
        throw new Error('A file expanded beyond its declared or allowed size. This archive may be unsafe.');
      }
      chunks.push(result.value);
    }
    if (size !== expected) throw new Error('A ZIP file did not match its declared uncompressed size.');
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  } catch (error) {
    if (error instanceof Error && /expanded beyond|declared uncompressed/.test(error.message)) throw error;
    throw new Error('A compressed file in this ZIP is corrupt or could not be decoded.');
  }
}

export async function readZip(file: File | Blob, onProgress?: (progress: number) => void): Promise<ZipEntry[]> {
  if (file.size > ZIP_LIMITS.maxArchiveBytes) throw new Error('ZIP files are limited to 80 MB for a safe browser import.');
  const data = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const minEnd = Math.max(0, data.length - 22 - 0xffff);
  let end = -1;
  for (let p = data.length - 22; p >= minEnd; p--) if (view.getUint32(p, true) === 0x06054b50) { end = p; break; }
  if (end < 0) throw new Error('This ZIP looks incomplete or uses an unsupported ZIP64 format.');
  assertRange(end, 22, data.length);
  const disk = view.getUint16(end + 4, true), directoryDisk = view.getUint16(end + 6, true);
  const commentLength = view.getUint16(end + 20, true);
  if (end + 22 + commentLength !== data.length) throw new Error('This ZIP has trailing or truncated data after its directory.');
  const diskEntries = view.getUint16(end + 8, true), count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true), directoryOffset = view.getUint32(end + 16, true);
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== count) throw new Error('Split ZIP packages are not supported.');
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error('ZIP64 packages are not supported by this browser import.');
  if (count > ZIP_LIMITS.maxEntries) throw new Error('This ZIP has too many files (maximum 3,000).');
  assertRange(directoryOffset, directorySize, data.length);

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const records: Array<{ path: string; method: number; compressed: number; size: number; crc: number; localOffset: number }> = [];
  const seen = new Set<string>();
  let cursor = directoryOffset, expanded = 0;
  for (let i = 0; i < count; i++) {
    assertRange(cursor, 46, data.length);
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The ZIP central directory is malformed.');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true), localOffset = view.getUint32(cursor + 42, true);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    assertRange(cursor, recordLength, data.length);
    if (flags & 0x1) throw new Error('Password-protected ZIP files are not supported.');
    if (flags & 0x40) throw new Error('Strong-encryption ZIP files are not supported.');
    if (nameLength === 0) throw new Error('A ZIP file contains an empty path.');
    let name: string;
    try { name = decoder.decode(data.subarray(cursor + 46, cursor + 46 + nameLength)); }
    catch { throw new Error('A ZIP filename is not valid UTF-8.'); }
    cursor += recordLength;
    if (name.endsWith('/')) continue;
    const path = normalizePackagePath(name);
    const key = path.toLocaleLowerCase('en-US');
    if (seen.has(key)) throw new Error(`Duplicate or case-colliding file path: ${path}`);
    seen.add(key);
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (unixType === 0xa000) throw new Error(`Symbolic links are not imported: ${path}`);
    if (size > ZIP_LIMITS.maxFileBytes) throw new Error(`A file is too large to import safely: ${path}`);
    if (compressed === 0 ? size > 0 : size / compressed > ZIP_LIMITS.maxCompressionRatio) throw new Error(`This ZIP has an unsafe compression ratio: ${path}`);
    expanded += size;
    if (expanded > ZIP_LIMITS.maxExpandedBytes) throw new Error('This ZIP expands beyond the 120 MB import limit.');
    records.push({ path, method, compressed, size, crc, localOffset });
  }
  if (cursor !== directoryOffset + directorySize) throw new Error('The ZIP central directory size is inconsistent.');

  const result: ZipEntry[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    assertRange(record.localOffset, 30, data.length);
    if (view.getUint32(record.localOffset, true) !== 0x04034b50) throw new Error(`A local file record is missing for ${record.path}.`);
    const localNameLength = view.getUint16(record.localOffset + 26, true), localExtraLength = view.getUint16(record.localOffset + 28, true);
    assertRange(record.localOffset + 30, localNameLength + localExtraLength, data.length);
    const localName = decoder.decode(data.subarray(record.localOffset + 30, record.localOffset + 30 + localNameLength)).replace(/\\/g,'/');
    if (localName !== record.path) throw new Error(`The ZIP filename records do not match for ${record.path}.`);
    const contentStart = record.localOffset + 30 + localNameLength + localExtraLength;
    assertRange(contentStart, record.compressed, data.length);
    const bytes = await inflate(record.method, data.subarray(contentStart, contentStart + record.compressed), record.size);
    if (crc32(bytes) !== record.crc) throw new Error(`The ZIP file “${record.path}” failed its integrity check.`);
    result.push({ path: record.path, blob: new Blob([toArrayBuffer(bytes)], { type: mimeType(record.path) }) });
    onProgress?.((i + 1) / Math.max(1, records.length));
  }
  return result;
}

export function mimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ({ html:'text/html', htm:'text/html', js:'text/javascript', mjs:'text/javascript', css:'text/css', json:'application/json', svg:'image/svg+xml', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', avif:'image/avif', mp3:'audio/mpeg', ogg:'audio/ogg', wav:'audio/wav', mp4:'video/mp4', webm:'video/webm', woff:'font/woff', woff2:'font/woff2', ttf:'font/ttf', otf:'font/otf', ico:'image/x-icon', wasm:'application/wasm', txt:'text/plain', xml:'application/xml', pdf:'application/pdf' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

export function createStoredZip(entries: Array<{ path: string; data: Uint8Array }>): Blob {
  const encoder = new TextEncoder(), locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const path = normalizePackagePath(entry.path);
    const name = encoder.encode(path), bytes = entry.data;
    if (name.length > 0xffff || bytes.length > 0xffffffff || offset > 0xffffffff) throw new Error('This ZIP exceeds the classic ZIP file format limits.');
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, bytes.length, true); lv.setUint32(22, bytes.length, true); lv.setUint16(26, name.length, true); local.set(name, 30);
    locals.push(local, bytes);
    const dir = new Uint8Array(46 + name.length), dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x800, true);
    dv.setUint32(16, crc, true); dv.setUint32(20, bytes.length, true); dv.setUint32(24, bytes.length, true); dv.setUint16(28, name.length, true); dv.setUint32(42, offset, true); dir.set(name, 46); central.push(dir);
    offset += local.length + bytes.length;
  }
  if (entries.length > 0xffff) throw new Error('This ZIP contains too many files.');
  const directory = central.reduce((sum, part) => sum + part.length, 0);
  if (offset > 0xffffffff || directory > 0xffffffff) throw new Error('This backup exceeds the classic ZIP file format limits.');
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true); view.setUint32(12, directory, true); view.setUint32(16, offset, true);
  return new Blob([...locals, ...central, end].map(toArrayBuffer), { type: 'application/zip' });
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
