import Dexie, { type Table } from 'dexie';
import type { AppSettings, Collection, ImportJob, LibraryAsset, LibraryItem, Subject, UsageRecord } from '../types';

class LocalDeckDatabase extends Dexie {
  items!: Table<LibraryItem, string>;
  assets!: Table<LibraryAsset, string>;
  collections!: Table<Collection, string>;
  subjects!: Table<Subject, string>;
  usage!: Table<UsageRecord, string>;
  settings!: Table<AppSettings, string>;
  importJobs!: Table<ImportJob, string>;

  constructor() {
    super('localdeck-library-v2');
    this.version(1).stores({
      items: '&id,type,subject,topic,importedAt,lastOpenedAt,favorite,*tags,*collectionIds',
      assets: '&id,itemId,[itemId+normalizedPath],contentHash',
      collections: '&id,name,updatedAt',
      subjects: '&id,name,parentId,updatedAt',
      usage: '&id,itemId,openedAt',
      settings: '&id,updatedAt',
      importJobs: '&id,status,createdAt',
    });
  }
}

export const db = new LocalDeckDatabase();

type LegacyProject = {
  id?: string; title?: string; type?: string; description?: string; subject?: string;
  tags?: string[]; collections?: string[]; favorite?: boolean; entry?: string;
  files?: Array<{ path?: string; blob?: Blob }>; created?: number; lastPlayed?: number;
};

function legacyType(value: string | undefined): LibraryItem['type'] {
  return value === 'learning' || value === 'game' || value === 'app' || value === 'tool' || value === 'simulation' || value === 'presentation' || value === 'document' || value === 'quiz' ? value : 'other';
}

async function readLegacyProjects(): Promise<LegacyProject[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('localdeck-library-v1', 1);
    request.onupgradeneeded = () => { request.transaction?.abort(); };
    request.onerror = () => request.error?.name === 'AbortError' ? resolve([]) : reject(request.error);
    request.onsuccess = () => {
      const old = request.result;
      if (!old.objectStoreNames.contains('projects')) { old.close(); resolve([]); return; }
      const get = old.transaction('projects', 'readonly').objectStore('projects').getAll();
      get.onsuccess = () => { old.close(); resolve((get.result ?? []) as LegacyProject[]); };
      get.onerror = () => { old.close(); reject(get.error); };
    };
  });
}

export async function openLibrary(): Promise<void> {
  await db.open();
  await db.items.filter(item => item.offlineCompatibility?.score === 'partial' && item.offlineCompatibility.findings.length === 1 && item.offlineCompatibility.findings[0]!.startsWith('No common remote-resource'))
    .modify(item => { item.offlineCompatibility = { ...item.offlineCompatibility, score: 'likely' }; }).catch(() => undefined);
  const migrated = await db.settings.get('migration-v1-complete');
  if (migrated) return;
  const oldProjects = await readLegacyProjects();
  await db.transaction('rw', db.items, db.assets, db.settings, async () => {
    for (const old of oldProjects) {
      if (!old.id || !old.files?.length || await db.items.get(old.id)) continue;
      const validFiles = old.files.filter((file): file is { path: string; blob: Blob } => typeof file.path === 'string' && file.blob instanceof Blob);
      if (!validFiles.length) continue;
      const now = Date.now();
      const item: LibraryItem = {
        id: old.id, title: old.title || 'Untitled project', type: legacyType(old.type), description: old.description || '',
        subject: old.subject || '', topic: '', genre: '', tags: Array.isArray(old.tags) ? old.tags : [],
        collectionIds: [], favorite: Boolean(old.favorite), artworkReferences: {}, entryFile: old.entry || validFiles[0].path,
        originalFilename: old.title || 'Imported project', storageSize: validFiles.reduce((sum, file) => sum + file.blob.size, 0),
        manifestVersion: 1, createdAt: old.created || now, updatedAt: now, importedAt: old.created || now,
        lastOpenedAt: old.lastPlayed || null, openCount: 0, runtimeSettings: {},
        offlineCompatibility: { score: 'unknown', findings: ['Migrated from an earlier LOCALDECK version; compatibility has not been re-scanned.'], checkedAt: now },
        packageId: old.id, fileCount: validFiles.length,
      };
      await db.items.add(item);
      await db.assets.bulkAdd(validFiles.map((file, index) => ({
        id: `${item.id}:${index}`, itemId: item.id, normalizedPath: file.path,
        mimeType: file.blob.type || 'application/octet-stream', fileSize: file.blob.size, contentHash: '', blob: file.blob,
      })));
    }
    await db.settings.put({ id: 'migration-v1-complete', value: true, updatedAt: Date.now() });
  });
  await db.open();
}

