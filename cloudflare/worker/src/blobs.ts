/* Encrypted projects up to 1 MiB, spread over several D1 databases.

   A database of the free plan holds 500 MB. The first one also keeps accounts and limits, the others hold only
   projects. `blob_index` in the first database says where each project is, so a database can be added or be
   unavailable without touching the others. Every version has its own row: a reader always gets a complete one. */

export interface BlobEnv { SHARES_DB: D1Database; PROJECTS_DB_2?: D1Database; PROJECTS_DB_3?: D1Database }
export type Store = { number: number; name: string; db: D1Database; capBytes: number };

const MIB = 1024 * 1024;
/** One row holds at most 2 MB, and base64 text needs a third more than the bytes. */
export const MAX_BLOB_BYTES = MIB + 64;

/** Full capacity is 500 MB of text. Base64 turns 340 MiB into about 475 MB. The first database keeps room for everything else. */
export function stores(env: BlobEnv): Store[] {
  return [
    { number: 1, name: 'localdeck-shares', db: env.SHARES_DB, capBytes: 250 * MIB },
    ...(env.PROJECTS_DB_2 ? [{ number: 2, name: 'localdeck-projects-2', db: env.PROJECTS_DB_2, capBytes: 340 * MIB }] : []),
    ...(env.PROJECTS_DB_3 ? [{ number: 3, name: 'localdeck-projects-3', db: env.PROJECTS_DB_3, capBytes: 340 * MIB }] : []),
  ];
}

export const BLOB_TABLE = 'CREATE TABLE IF NOT EXISTS blobs ( id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id, version) )';

type Base64Bytes = Uint8Array & { toBase64?: () => string };
export function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Base64Bytes).toBase64;
  if (native) return native.call(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function fromBase64(text: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (value: string) => Uint8Array }).fromBase64;
  return native ? native.call(Uint8Array, text) : Uint8Array.from(atob(text), char => char.charCodeAt(0));
}

const ready = new WeakSet<D1Database>();
async function prepareStore(store: Store): Promise<void> {
  if (ready.has(store.db)) return;
  await store.db.prepare(BLOB_TABLE).run();
  ready.add(store.db);
}

export async function usage(env: BlobEnv): Promise<Array<Store & { bytes: number; projects: number }>> {
  const rows = await env.SHARES_DB.prepare('SELECT store, SUM(bytes) as bytes, COUNT(*) as projects FROM blob_index GROUP BY store').bind().all<{ store: number; bytes: number; projects: number }>();
  return stores(env).map(store => { const row = rows.results.find(entry => entry.store === store.number); return { ...store, bytes: row?.bytes ?? 0, projects: row?.projects ?? 0 }; });
}

/** Writes a version and returns the database it went to. Uses the emptiest one and moves on when a database fails. */
export async function putBlob(env: BlobEnv, id: string, version: number, bytes: Uint8Array): Promise<number | null> {
  const order = (await usage(env)).filter(store => store.bytes + bytes.length <= store.capBytes).sort((a, b) => a.bytes / a.capBytes - b.bytes / b.capBytes || b.number - a.number);
  const data = toBase64(bytes);
  for (const store of order) {
    try {
      await prepareStore(store);
      await store.db.prepare('INSERT OR REPLACE INTO blobs (id, version, data) VALUES (?, ?, ?)').bind(id, version, data).run();
      return store.number;
    } catch (error) { console.error('blob_store_failed', store.name, error instanceof Error ? error.message : 'unknown'); }
  }
  return null;
}

/** A failed delete leaves unused bytes behind, never a broken project. */
export async function dropVersion(env: BlobEnv, storeNumber: number, id: string, version: number): Promise<void> {
  const store = stores(env).find(entry => entry.number === storeNumber);
  if (store) await store.db.prepare('DELETE FROM blobs WHERE id = ? AND version = ?').bind(id, version).run().catch(() => undefined);
}

export async function indexBlob(env: BlobEnv, id: string, store: number, version: number, bytes: number): Promise<void> {
  await env.SHARES_DB.prepare('INSERT INTO blob_index (id, store, version, bytes) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET store = excluded.store, version = excluded.version, bytes = excluded.bytes').bind(id, store, version, bytes).run();
}

/** Null: this share is not stored here. 'missing': it should be, but its database did not deliver it. */
export async function readBlob(env: BlobEnv, id: string): Promise<{ bytes: Uint8Array; version: number; store: number } | 'missing' | null> {
  // A change between the two queries moves the project on, so look once more before giving up.
  for (let attempt = 0; attempt < 2; attempt++) {
    const entry = await env.SHARES_DB.prepare('SELECT store, version FROM blob_index WHERE id = ?').bind(id).first<{ store: number; version: number }>();
    if (!entry) return null;
    const store = stores(env).find(candidate => candidate.number === entry.store);
    const row = store ? await store.db.prepare('SELECT data FROM blobs WHERE id = ? AND version = ?').bind(id, entry.version).first<{ data: string }>() : null;
    if (row) return { bytes: fromBase64(row.data), version: entry.version, store: entry.store };
  }
  return 'missing';
}

/** Removes a project from its database. True when there was one. */
export async function removeBlob(env: BlobEnv, id: string): Promise<boolean> {
  const entry = await env.SHARES_DB.prepare('SELECT store FROM blob_index WHERE id = ?').bind(id).first<{ store: number }>();
  if (!entry) return false;
  const store = stores(env).find(candidate => candidate.number === entry.store);
  if (store) await store.db.prepare('DELETE FROM blobs WHERE id = ?').bind(id).run();
  await env.SHARES_DB.prepare('DELETE FROM blob_index WHERE id = ?').bind(id).run();
  return true;
}

/** Removes projects whose share is gone. D1 has no expiry of its own. */
export async function sweepBlobs(env: BlobEnv): Promise<void> {
  const rows = await env.SHARES_DB.prepare('SELECT id, store FROM blob_index WHERE NOT EXISTS (SELECT 1 FROM shares WHERE shares.id = blob_index.id) LIMIT 60').bind().all<{ id: string; store: number }>();
  for (const store of stores(env)) {
    const ids = rows.results.filter(row => row.store === store.number).map(row => row.id);
    if (!ids.length) continue;
    const marks = ids.map(() => '?').join(', ');
    try {
      await store.db.prepare(`DELETE FROM blobs WHERE id IN (${marks})`).bind(...ids).run();
      await env.SHARES_DB.prepare(`DELETE FROM blob_index WHERE id IN (${marks})`).bind(...ids).run();
    } catch (error) { console.error('blob_sweep_failed', store.name, error instanceof Error ? error.message : 'unknown'); }
  }
}
