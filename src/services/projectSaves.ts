/* What projects saved with localStorage and cookies (services/playerRuntime). The player receives it from the project
   and keeps it here. One record per project, on this device only. */
const DB = 'localdeck-project-saves';

export type ProjectSave = { id: string; local: Record<string, string>; cookies: string; updatedAt: number };

function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function readProjectSave(itemId: string): Promise<ProjectSave | null> {
  const db = await open();
  if (!db) return null;
  return new Promise(resolve => {
    const get = db.transaction('saves').objectStore('saves').get(itemId);
    get.onsuccess = () => { db.close(); resolve((get.result as ProjectSave | undefined) ?? null); };
    get.onerror = () => { db.close(); resolve(null); };
  });
}

export async function deleteProjectSave(itemId: string): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>(resolve => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').delete(itemId); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
  db.close();
}

/** Size of the saved values, in bytes, as the browser counts them. */
export const saveSize = (save: ProjectSave) => (Object.entries(save.local).reduce((sum, [key, value]) => sum + key.length + value.length, 0) + save.cookies.length) * 2;

/** Stores what the player received from a project. Anything that is not text, or too much, is refused. */
export async function writeProjectSave(itemId: string, local: unknown, cookies: unknown): Promise<boolean> {
  if (!local || typeof local !== 'object' || Array.isArray(local)) return false;
  const values = Object.entries(local as Record<string, unknown>);
  if (!values.every(([, value]) => typeof value === 'string')) return false;
  const save: ProjectSave = { id: itemId, local: Object.fromEntries(values) as Record<string, string>, cookies: typeof cookies === 'string' ? cookies.slice(0, 8192) : '', updatedAt: Date.now() };
  if (saveSize(save) > 5 * 1024 * 1024 + 16_384) return false;
  const db = await open();
  if (!db) return false;
  await new Promise<void>(resolve => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(save); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
  db.close();
  return true;
}
