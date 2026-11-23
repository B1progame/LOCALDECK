import Dexie, { type Table } from 'dexie';
import type {
  HistoryEntry,
  LibraryCollection,
  LibraryItem,
  ProgressRecord,
  QuizResult,
  SchoolSubject,
  ShareRecord,
  StoredArtwork,
  StoredFile,
} from '@/types/models';

/**
 * Database name and the `files` store layout are also read by public/sw.js.
 * Keep them in sync: files are keyed by the compound key [itemId, path].
 */
export const DB_NAME = 'localdeck';

export class LocalDeckDB extends Dexie {
  items!: Table<LibraryItem, string>;
  files!: Table<StoredFile, [string, string]>;
  artwork!: Table<StoredArtwork, string>;
  collections!: Table<LibraryCollection, string>;
  subjects!: Table<SchoolSubject, string>;
  history!: Table<HistoryEntry, number>;
  quiz!: Table<QuizResult, number>;
  progress!: Table<ProgressRecord, string>;
  shares!: Table<ShareRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      items: 'id, type, subjectId, createdAt, lastOpenedAt',
      files: '[itemId+path], itemId',
      artwork: 'id',
      collections: 'id',
      subjects: 'id',
      history: '++id, itemId, openedAt',
      quiz: '++id, itemId, at',
      progress: 'itemId',
      shares: 'id, itemId',
    });
  }
}

export const db = new LocalDeckDB();
