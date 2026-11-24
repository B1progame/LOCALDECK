/* Links created on this device. The server never gets the key of a link, so this is the only place
   that can show a link again. Backups leave these records out (src/services/backups.ts). */
import { db } from './database';

export type SavedShare = { title?: string; type?: string; key?: string; expiresAt?: string };

const recordId = (id: string) => `share-${id}`;

/** The complete link, including the secret part after "k=". */
export function shareUrl(id: string, key: string): string {
  return `${location.origin}${location.pathname}#/shared/${id}?k=${key}`;
}

export async function saveShare(id: string, share: SavedShare): Promise<void> {
  await db.settings.put({ id: recordId(id), value: share, updatedAt: Date.now() });
}

/** Adds the key of a link from this device that was created before LocalDeck kept keys. Links of other people are not stored. */
export async function rememberKey(id: string, key: string, expiresAt: string): Promise<void> {
  const record = await db.settings.get(recordId(id));
  const saved = record?.value as SavedShare | undefined;
  if (saved && !saved.key) await saveShare(id, { ...saved, key, expiresAt });
}

/** All links of this device, without the ones that ran out. */
export async function savedShares(): Promise<Record<string, SavedShare>> {
  const rows = await db.settings.where('id').startsWith('share-').toArray();
  const result: Record<string, SavedShare> = {};
  for (const row of rows) {
    const share = row.value as SavedShare;
    if (share?.expiresAt && Date.parse(share.expiresAt) <= Date.now()) { await db.settings.delete(row.id); continue; }
    result[row.id.slice('share-'.length)] = share ?? {};
  }
  return result;
}

export async function forgetShare(id: string): Promise<void> {
  await db.settings.delete(recordId(id));
}
