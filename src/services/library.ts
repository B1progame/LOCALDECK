import { db } from './database';
import type { AppSettings, Collection, ContentType, ImportJob, ImportPreview, LibraryAsset, LibraryItem, Subject, UsageRecord } from '../types';

export type ItemFilters = { type?: ContentType; subject?: string; collectionId?: string; favorite?: boolean; query?: string };
export type ItemSort = 'name' | 'imported' | 'opened' | 'size' | 'modified';
const id = () => crypto.randomUUID();

function createItemFromPreview(preview: ImportPreview, itemId = id()): LibraryItem {
  const now = Date.now();
  return {
    id: itemId, title: preview.title.trim() || 'Untitled project', type: preview.type, description: preview.description,
    subject: preview.subject, topic: preview.topic, genre: preview.manifest?.genre ?? '', tags: [...preview.tags], collectionIds: [],
    favorite: false, artworkReferences: {
      ...(preview.manifest?.cover ? { cover: preview.manifest.cover } : {}), ...(preview.manifest?.banner ? { banner: preview.manifest.banner } : {}),
      ...(preview.manifest?.icon ? { icon: preview.manifest.icon } : {}),
    },
    entryFile: preview.selectedEntry, originalFilename: preview.sourceName, storageSize: preview.storageSize,
    manifestVersion: preview.manifest?.schemaVersion ?? 1, createdAt: now, updatedAt: now, importedAt: now,
    lastOpenedAt: null, openCount: 0, runtimeSettings: { preferredOrientation: preview.manifest?.preferredOrientation ?? 'any' },
    offlineCompatibility: preview.report, packageId: itemId, fileCount: preview.files.length,
  };
}

export async function createItem(preview: ImportPreview): Promise<LibraryItem> {
  if (!preview.files.length || !preview.files.some(file => file.path === preview.selectedEntry)) throw new Error('Choose a valid entry file before saving this project.');
  const item = createItemFromPreview(preview);
  const job: ImportJob = {
    id: id(), source: preview.sourceName, status: 'committing', progress: 0, detectedFiles: preview.files.map(file => file.path),
    validationErrors: [], completionState: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
  };
  await db.importJobs.put(job);
  try {
    await db.transaction('rw', db.items, db.assets, db.importJobs, async () => {
      await db.items.add(item);
      const assets: LibraryAsset[] = preview.files.map((file, index) => ({
        id: `${item.id}:${index}`, itemId: item.id, normalizedPath: file.path, mimeType: file.mimeType,
        fileSize: file.size, contentHash: file.contentHash, blob: file.blob,
      }));
      await db.assets.bulkAdd(assets);
      job.status = 'complete'; job.progress = 1; job.completionState = 'verified'; job.updatedAt = Date.now();
      await db.importJobs.put(job);
      const stored = await db.assets.where('itemId').equals(item.id).count();
      if (stored !== item.fileCount || !await db.assets.where('[itemId+normalizedPath]').equals([item.id, item.entryFile]).first()) throw new Error('The saved project did not pass its file integrity check.');
    });
    return item;
  } catch (error) {
    job.status = 'failed'; job.completionState = 'rolled-back'; job.updatedAt = Date.now();
    job.validationErrors = [error instanceof Error ? error.message : 'Storage failed.'];
    await db.importJobs.put(job).catch(() => undefined);
    if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new Error('Browser storage is full. Export a backup or remove large projects, then try again.');
    throw error;
  }
}

export async function replaceItemFiles(itemId: string, preview: ImportPreview): Promise<LibraryItem> {
  if (!preview.files.length || !preview.files.some(file => file.path === preview.selectedEntry)) throw new Error('Choose a valid project package before updating this project.');
  const prepared = preview.files.map((file, index) => ({
    id: `${itemId}:${index}`, itemId, normalizedPath: file.path, mimeType: file.mimeType,
    fileSize: file.size, contentHash: file.contentHash, blob: file.blob,
  }));
  let updated: LibraryItem | undefined;
  await db.transaction('rw', db.items, db.assets, async () => {
    const current = await db.items.get(itemId);
    if (!current) throw new Error('This project is no longer in your library.');
    const manifest = preview.manifest;
    const included = (path?: string) => Boolean(path && preview.files.some(file => file.path === path));
    const artwork = manifest ? {
      ...(included(manifest.cover) ? { cover: manifest.cover } : {}),
      ...(included(manifest.banner) ? { banner: manifest.banner } : {}),
      ...(included(manifest.icon) ? { icon: manifest.icon } : {}),
    } : current.artworkReferences;
    updated = {
      ...current,
      ...(manifest ? { title: preview.title.trim() || current.title, type: preview.type, description: preview.description, subject: preview.subject, topic: preview.topic, genre: manifest.genre ?? '', tags: [...preview.tags], artworkReferences: artwork } : {}),
      entryFile: preview.selectedEntry, originalFilename: preview.sourceName,
      storageSize: preview.storageSize, fileCount: preview.files.length,
      manifestVersion: manifest?.schemaVersion ?? current.manifestVersion,
      offlineCompatibility: preview.report,
      runtimeSettings: manifest?.preferredOrientation ? { ...current.runtimeSettings, preferredOrientation: manifest.preferredOrientation } : current.runtimeSettings,
      updatedAt: Date.now(),
    };
    await db.assets.where('itemId').equals(itemId).delete();
    await db.assets.bulkAdd(prepared);
    await db.items.put(updated);
    const stored = await db.assets.where('itemId').equals(itemId).count();
    if (stored !== updated.fileCount || !await db.assets.where('[itemId+normalizedPath]').equals([itemId, updated.entryFile]).first()) throw new Error('The updated project did not pass its file integrity check.');
  });
  return updated!;
}

export async function createItems(previews: ImportPreview[]): Promise<LibraryItem[]> {
  const imported: LibraryItem[] = [];
  for (const preview of previews) imported.push(await createItem(preview));
  return imported;
}

export async function getItem(itemId: string): Promise<LibraryItem | undefined> { return db.items.get(itemId); }
export async function getAllItems(): Promise<LibraryItem[]> { return db.items.toArray(); }
export async function getAssets(itemId: string): Promise<LibraryAsset[]> { return db.assets.where('itemId').equals(itemId).sortBy('normalizedPath'); }

export async function updateHtmlAsset(itemId: string, path: string, source: string): Promise<void> {
  if (!/\.html?$/i.test(path)) throw new Error('Only HTML files can be edited here.');
  const blob = new Blob([source], { type: 'text/html; charset=utf-8' });
  let contentHash = '';
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
    contentHash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  await db.transaction('rw', db.items, db.assets, async () => {
    const item = await db.items.get(itemId);
    const asset = await db.assets.where('[itemId+normalizedPath]').equals([itemId, path]).first();
    if (!item || !asset) throw new Error('This HTML file is no longer in your library.');
    await db.assets.put({ ...asset, blob, fileSize: blob.size, mimeType: blob.type, contentHash });
    await db.items.put({ ...item, storageSize: Math.max(0, item.storageSize + blob.size - asset.fileSize), updatedAt: Date.now() });
  });
}

export async function updateItem(itemId: string, changes: Partial<Omit<LibraryItem, 'id' | 'packageId' | 'createdAt' | 'importedAt'>>): Promise<LibraryItem> {
  let updated: LibraryItem | undefined;
  await db.transaction('rw', db.items, async () => {
    const current = await db.items.get(itemId);
    if (!current) throw new Error('This project is no longer in your library.');
    updated = { ...current, ...changes, id: current.id, packageId: current.packageId, createdAt: current.createdAt, importedAt: current.importedAt, updatedAt: Date.now() };
    await db.items.put(updated);
  });
  return updated!;
}

export async function deleteItem(itemId: string): Promise<void> {
  await db.transaction('rw', db.items, db.assets, db.usage, db.collections, async () => {
    await db.items.delete(itemId);
    await db.assets.where('itemId').equals(itemId).delete();
    await db.usage.where('itemId').equals(itemId).delete();
    const collections = await db.collections.toArray();
    await Promise.all(collections.map(collection => db.collections.put({ ...collection, orderedItemIds: collection.orderedItemIds.filter(x => x !== itemId), updatedAt: Date.now() })));
  });
}

export async function duplicateItem(itemId: string): Promise<LibraryItem> {
  const original = await db.items.get(itemId);
  if (!original) throw new Error('This project is no longer in your library.');
  const assets = await getAssets(itemId), duplicateId = id(), now = Date.now();
  const clone: LibraryItem = { ...original, id: duplicateId, title: `${original.title} copy`, favorite: false, collectionIds: [], packageId: duplicateId, createdAt: now, updatedAt: now, importedAt: now, lastOpenedAt: null, openCount: 0 };
  await db.transaction('rw', db.items, db.assets, async () => {
    await db.items.add(clone);
    await db.assets.bulkAdd(assets.map((asset, index) => ({ ...asset, id: `${duplicateId}:${index}`, itemId: duplicateId })));
  });
  return clone;
}

export async function toggleFavorite(itemId: string): Promise<LibraryItem> {
  const item = await db.items.get(itemId);
  if (!item) throw new Error('This project is no longer in your library.');
  return updateItem(itemId, { favorite: !item.favorite });
}

export async function filterItems(filters: ItemFilters = {}, sort: ItemSort = 'imported'): Promise<LibraryItem[]> {
  let items = await db.items.toArray();
  const query = filters.query?.trim().toLocaleLowerCase();
  if (filters.type) items = items.filter(item => item.type === filters.type);
  if (filters.subject) items = items.filter(item => item.subject.toLocaleLowerCase() === filters.subject!.toLocaleLowerCase());
  if (filters.favorite !== undefined) items = items.filter(item => item.favorite === filters.favorite);
  if (filters.collectionId) items = items.filter(item => item.collectionIds.includes(filters.collectionId!));
  if (query) items = items.filter(item => [item.title, item.description, item.subject, item.topic, item.genre, item.type, ...item.tags].join(' ').toLocaleLowerCase().includes(query));
  const sorters: Record<ItemSort, (a: LibraryItem,b: LibraryItem) => number> = {
    name: (a,b) => a.title.localeCompare(b.title), imported: (a,b) => b.importedAt - a.importedAt,
    opened: (a,b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0), size: (a,b) => b.storageSize - a.storageSize,
    modified: (a,b) => b.updatedAt - a.updatedAt,
  };
  return items.sort(sorters[sort]);
}

export async function searchItems(query: string): Promise<LibraryItem[]> { return filterItems({ query }, 'name'); }
export async function sortItems(sort: ItemSort): Promise<LibraryItem[]> { return filterItems({}, sort); }

export async function addToCollection(itemId: string, collectionId: string): Promise<void> {
  const item = await db.items.get(itemId); if (!item) throw new Error('Project not found.');
  const collection = await db.collections.get(collectionId); if (!collection) throw new Error('Collection not found.');
  await db.transaction('rw', db.items, db.collections, async () => {
    await db.items.put({ ...item, collectionIds: [...new Set([...item.collectionIds, collectionId])], updatedAt: Date.now() });
    await db.collections.put({ ...collection, orderedItemIds: [...new Set([...collection.orderedItemIds, itemId])], updatedAt: Date.now() });
  });
}

export async function removeFromCollection(itemId: string, collectionId: string): Promise<void> {
  const item = await db.items.get(itemId); const collection = await db.collections.get(collectionId);
  await db.transaction('rw', db.items, db.collections, async () => {
    if (item) await db.items.put({ ...item, collectionIds: item.collectionIds.filter(x => x !== collectionId), updatedAt: Date.now() });
    if (collection) await db.collections.put({ ...collection, orderedItemIds: collection.orderedItemIds.filter(x => x !== itemId), updatedAt: Date.now() });
  });
}

export async function createCollection(name: string, description = ''): Promise<Collection> {
  const normalized = name.trim(); if (!normalized) throw new Error('Enter a collection name.');
  if (await db.collections.where('name').equalsIgnoreCase(normalized).first()) throw new Error('A collection with that name already exists.');
  const now = Date.now(); const value: Collection = { id: id(), name: normalized, description: description.trim(), accentColor: '#7561d6', orderedItemIds: [], createdAt: now, updatedAt: now };
  await db.collections.add(value); return value;
}

export async function updateCollection(collectionId: string, changes: Partial<Pick<Collection,'name'|'description'|'cover'|'accentColor'|'orderedItemIds'|'smartRule'>>): Promise<Collection> {
  const current = await db.collections.get(collectionId); if (!current) throw new Error('Collection not found.');
  const updated = { ...current, ...changes, updatedAt: Date.now() }; await db.collections.put(updated); return updated;
}

export async function deleteCollection(collectionId: string): Promise<void> {
  await db.transaction('rw', db.items, db.collections, async () => {
    await db.collections.delete(collectionId);
    const items = await db.items.where('collectionIds').equals(collectionId).toArray();
    await Promise.all(items.map(item => db.items.put({ ...item, collectionIds: item.collectionIds.filter(x => x !== collectionId), updatedAt: Date.now() })));
  });
}

export async function getCollections(): Promise<Collection[]> { return db.collections.orderBy('name').toArray(); }
export async function getSubjects(): Promise<Subject[]> { return db.subjects.orderBy('name').toArray(); }

export async function saveSubject(input: Pick<Subject,'name'> & Partial<Pick<Subject,'id'|'description'|'color'|'icon'|'parentId'>>): Promise<Subject> {
  const name = input.name.trim(); if (!name) throw new Error('Enter a subject name.');
  const now = Date.now(), existing = input.id ? await db.subjects.get(input.id) : undefined;
  const value: Subject = { id: existing?.id ?? input.id ?? id(), name, description: input.description ?? existing?.description ?? '', color: input.color ?? existing?.color ?? '#8b80dc', icon: input.icon ?? existing?.icon ?? 'book', parentId: input.parentId ?? existing?.parentId, createdAt: existing?.createdAt ?? now, updatedAt: now };
  await db.subjects.put(value); return value;
}

export async function recordOpenSession(itemId: string): Promise<UsageRecord> {
  const item = await db.items.get(itemId); if (!item) throw new Error('This project is no longer in your library.');
  const now = Date.now(), record: UsageRecord = { id: id(), itemId, openedAt: now };
  await db.transaction('rw', db.items, db.usage, async () => {
    await db.items.put({ ...item, lastOpenedAt: now, openCount: item.openCount + 1, updatedAt: now });
    await db.usage.add(record);
  });
  return record;
}

export async function finishOpenSession(recordId: string, durationMs: number): Promise<void> {
  const record = await db.usage.get(recordId);
  if (!record) return;
  await db.usage.put({ ...record, durationMs: Math.max(0, Math.floor(durationMs)) });
}

export async function getRecentlyOpened(limit = 20): Promise<LibraryItem[]> {
  const recent = await db.usage.orderBy('openedAt').reverse().limit(limit * 3).toArray();
  const seen = new Set<string>(), ids: string[] = [];
  for (const row of recent) if (!seen.has(row.itemId)) { seen.add(row.itemId); ids.push(row.itemId); if (ids.length >= limit) break; }
  return (await Promise.all(ids.map(x => db.items.get(x)))).filter((x): x is LibraryItem => Boolean(x));
}

export async function getSettings<T>(key: string, fallback: T): Promise<T> { return ((await db.settings.get(key))?.value as T | undefined) ?? fallback; }
export async function setSettings(key: string, value: unknown): Promise<AppSettings> { const setting = { id: key, value, updatedAt: Date.now() }; await db.settings.put(setting); return setting; }

export async function checkLibraryIntegrity(): Promise<{ orphanAssetCount: number; incompleteItemIds: string[] }> {
  const items = await db.items.toArray(), assets = await db.assets.toArray(), ids = new Set(items.map(x => x.id));
  const orphanAssetCount = assets.filter(asset => !ids.has(asset.itemId)).length;
  const incompleteItemIds: string[] = [];
  for (const item of items) {
    const files = assets.filter(asset => asset.itemId === item.id);
    if (files.length !== item.fileCount || !files.some(asset => asset.normalizedPath === item.entryFile)) incompleteItemIds.push(item.id);
  }
  return { orphanAssetCount, incompleteItemIds };
}

export async function repairLibrary(): Promise<{ removedAssets: number; removedItems: number }> {
  const integrity = await checkLibraryIntegrity();
  let removedAssets = 0, removedItems = 0;
  await db.transaction('rw', db.items, db.assets, db.usage, db.collections, async () => {
    const allItems = await db.items.toArray(), itemIds = new Set(allItems.map(x => x.id));
    const orphanAssets = (await db.assets.toArray()).filter(x => !itemIds.has(x.itemId));
    removedAssets = orphanAssets.length; await db.assets.bulkDelete(orphanAssets.map(x => x.id));
    const invalid = new Set(integrity.incompleteItemIds);
    removedItems = invalid.size;
    for (const itemId of invalid) {
      await db.items.delete(itemId); await db.assets.where('itemId').equals(itemId).delete(); await db.usage.where('itemId').equals(itemId).delete();
    }
    if (invalid.size) {
      const collections = await db.collections.toArray();
      for (const collection of collections) await db.collections.put({ ...collection, orderedItemIds: collection.orderedItemIds.filter(itemId => !invalid.has(itemId)) });
    }
  });
  return { removedAssets, removedItems };
}

