import { db } from './database';
import { getAssets } from './library';
import { normalizePackagePath, readZip, createStoredZip, ZIP_LIMITS } from './zip';
import type { AppSettings, Collection, LibraryAsset, LibraryItem, ProjectManifest, Subject } from '../types';

type ItemSnapshot = { item: LibraryItem; assets: Array<Omit<LibraryAsset, 'blob'>> };
type BackupManifest = { format: 'LOCALDECK_BACKUP'; version: 1; exportedAt: string; items: ItemSnapshot[]; collections: Collection[]; subjects: Subject[]; settings: AppSettings[] };
export type RestoreConflictMode = 'keep-both' | 'skip' | 'replace';
const textEncoder = new TextEncoder();

function parseBackup(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object') throw new Error('This file is not a LOCALDECK backup.');
  const data = value as Partial<BackupManifest>;
  if (data.format !== 'LOCALDECK_BACKUP' || data.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.collections) || !Array.isArray(data.subjects) || !Array.isArray(data.settings)) {
    throw new Error('This backup uses an unsupported format or version.');
  }
  const ids = new Set<string>();
  for (const snapshot of data.items) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.item || typeof snapshot.item.id !== 'string' || !Array.isArray(snapshot.assets)) throw new Error('A project record in this backup is malformed.');
    if (ids.has(snapshot.item.id)) throw new Error('This backup contains duplicate project IDs.');
    ids.add(snapshot.item.id);
    if (!snapshot.item.title || !snapshot.item.entryFile || !snapshot.assets.length || snapshot.assets.length !== snapshot.item.fileCount) throw new Error(`Project “${snapshot.item.title || 'Untitled'}” has incomplete metadata.`);
  }
  return data as BackupManifest;
}

export async function exportItem(itemId: string): Promise<Blob> {
  const item = await db.items.get(itemId); if (!item) throw new Error('This project is no longer in your library.');
  const assets = await getAssets(itemId);
  if (!assets.some(x => x.normalizedPath === item.entryFile)) throw new Error('The project entry page is missing. Run the storage repair check before exporting.');
  const entries = await Promise.all(assets.map(async asset => ({ path: normalizePackagePath(asset.normalizedPath), data: new Uint8Array(await asset.blob.arrayBuffer()) })));
  if (!entries.some(x => x.path.toLowerCase() === 'localdeck.json')) {
    const manifest: ProjectManifest = {
      schemaVersion: 1, title: item.title, description: item.description, type: item.type, format: item.type === 'document' ? 'pdf' : 'html',
      subject: item.subject, topic: item.topic, genre: item.genre, tags: item.tags, entry: item.entryFile,
      preferredOrientation: item.runtimeSettings.preferredOrientation,
      ...(item.artworkReferences.cover ? { cover: item.artworkReferences.cover } : {}),
      ...(item.artworkReferences.banner ? { banner: item.artworkReferences.banner } : {}),
      ...(item.artworkReferences.icon ? { icon: item.artworkReferences.icon } : {}),
    };
    entries.push({ path: 'localdeck.json', data: textEncoder.encode(JSON.stringify(manifest, null, 2)) });
  }
  return createStoredZip(entries);
}

export async function exportLibrary(): Promise<Blob> {
  const items = await db.items.toArray(), collections = await db.collections.toArray(), subjects = await db.subjects.toArray();
  const settings = (await db.settings.toArray()).filter(x => !x.id.startsWith('share-') && x.id !== 'migration-v1-complete');
  const entries: Array<{ path: string; data: Uint8Array }> = [];
  const snapshots: ItemSnapshot[] = [];
  for (const item of items) {
    const assets = await getAssets(item.id);
    snapshots.push({ item, assets: assets.map(({ blob: _blob, ...metadata }) => metadata) });
    for (const asset of assets) entries.push({ path: `items/${item.id}/${normalizePackagePath(asset.normalizedPath)}`, data: new Uint8Array(await asset.blob.arrayBuffer()) });
  }
  const manifest: BackupManifest = { format: 'LOCALDECK_BACKUP', version: 1, exportedAt: new Date().toISOString(), items: snapshots, collections, subjects, settings };
  entries.push({ path: 'localdeck-backup.json', data: textEncoder.encode(JSON.stringify(manifest)) });
  return createStoredZip(entries);
}

async function sha256(blob: Blob): Promise<string> {
  if (!crypto.subtle) return '';
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function newId(): string { return crypto.randomUUID(); }

export async function restoreLibrary(file: File, conflictMode: RestoreConflictMode = 'keep-both'): Promise<{ restored: number; skipped: number; remapped: number }> {
  if (file.size > ZIP_LIMITS.maxArchiveBytes) throw new Error('Backups are limited to 140 MB for safe browser restoration.');
  const entries = await readZip(file);
  const manifestFile = entries.find(x => x.path === 'localdeck-backup.json');
  if (!manifestFile) throw new Error('This ZIP does not contain a LOCALDECK backup manifest.');
  const manifest = parseBackup(JSON.parse(await manifestFile.blob.text()));
  const entryMap = new Map(entries.map(x => [x.path, x.blob]));
  const total = entries.reduce((sum, x) => sum + x.blob.size, 0);
  if (total > ZIP_LIMITS.maxExpandedBytes) throw new Error('This backup exceeds the 120 MB browser restore limit.');

  const existing = new Set((await db.items.toArray()).map(x => x.id));
  const existingCollectionIds = new Set((await db.collections.toArray()).map(x => x.id));
  const idMap = new Map<string, string>(), skippedIds = new Set<string>();
  // A collection that already exists keeps its id; restored projects are merged into it.
  const collectionMap = new Map(manifest.collections.map(collection => [collection.id, collection.id]));
  let remapped = 0;
  for (const snapshot of manifest.items) {
    const oldId = snapshot.item.id;
    if (!existing.has(oldId)) { idMap.set(oldId, oldId); continue; }
    if (conflictMode === 'skip') { skippedIds.add(oldId); continue; }
    if (conflictMode === 'replace') { idMap.set(oldId, oldId); continue; }
    const freshId = newId(); idMap.set(oldId, freshId); remapped++;
  }

  const itemWrites: LibraryItem[] = [], assetWrites: LibraryAsset[] = [];
  for (const snapshot of manifest.items) {
    const mappedId = idMap.get(snapshot.item.id);
    if (!mappedId) continue;
    const item = { ...snapshot.item, id: mappedId, packageId: mappedId, updatedAt: Date.now(), collectionIds: snapshot.item.collectionIds.map(x => collectionMap.get(x) ?? x) };
    const localAssets = await Promise.all(snapshot.assets.map(async (asset, index) => {
      const path = normalizePackagePath(asset.normalizedPath);
      const dataPath = `items/${snapshot.item.id}/${path}`;
      const blob = entryMap.get(dataPath);
      if (!blob) throw new Error(`Backup file “${path}” is missing for project “${snapshot.item.title}”.`);
      if (blob.size !== asset.fileSize) throw new Error(`Backup file “${path}” has an unexpected size.`);
      if (asset.contentHash && await sha256(blob) !== asset.contentHash) throw new Error(`Backup file “${path}” failed its integrity check.`);
      return { ...asset, id: `${mappedId}:${index}`, itemId: mappedId, blob } as LibraryAsset;
    }));
    const entryAsset = localAssets.find(asset => asset.normalizedPath === item.entryFile);
    if (!entryAsset) throw new Error(`Project “${item.title}” does not contain its entry file.`);
    itemWrites.push(item); assetWrites.push(...localAssets);
  }

  // The entire archive is checked before this transaction. A failed write rolls back all imported rows.
  await db.transaction('rw', db.items, db.assets, db.collections, db.subjects, db.settings, async () => {
    if (conflictMode === 'replace') {
      const replaceIds = manifest.items.filter(snapshot => existing.has(snapshot.item.id) && !skippedIds.has(snapshot.item.id)).map(snapshot => snapshot.item.id);
      for (const replaceId of replaceIds) { await db.assets.where('itemId').equals(replaceId).delete(); await db.items.delete(replaceId); }
    }
    for (const item of itemWrites) {
      if (skippedIds.has(item.id)) continue;
      const assetRows = assetWrites.filter(asset => asset.itemId === item.id);
      if (assetRows.length !== item.fileCount) throw new Error(`Project “${item.title}” has inconsistent file metadata.`);
    }
    await db.items.bulkPut(itemWrites);
    await db.assets.bulkPut(assetWrites);
    for (const collection of manifest.collections) {
      const mappedItems = collection.orderedItemIds.map(x => idMap.get(x)).filter((x): x is string => Boolean(x));
      const collectionId = collectionMap.get(collection.id) ?? collection.id;
      const current = existingCollectionIds.has(collectionId) ? await db.collections.get(collectionId) : undefined;
      await db.collections.put(current
        ? { ...current, orderedItemIds: [...new Set([...current.orderedItemIds, ...mappedItems])], updatedAt: Date.now() }
        : { ...collection, id: collectionId, orderedItemIds: mappedItems, updatedAt: Date.now() });
    }
    for (const subject of manifest.subjects) {
      const collision = await db.subjects.where('name').equalsIgnoreCase(subject.name).first();
      await db.subjects.put(collision && conflictMode === 'keep-both' ? { ...subject, id: newId(), name: `${subject.name} (restored)` } : subject);
    }
    for (const setting of manifest.settings) await db.settings.put(setting);
  });
  const restored = itemWrites.length;
  return { restored, skipped: skippedIds.size, remapped };
}
