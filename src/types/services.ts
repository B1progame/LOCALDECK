/**
 * Typed service boundaries. The UI talks only to these interfaces; the local
 * implementations live in `src/services`. A future backend can provide other
 * implementations without UI changes. See FRONTEND_HANDOFF.md.
 */
import type {
  CompatibilityReport,
  HistoryEntry,
  ImportJob,
  LibraryCollection,
  LibraryItem,
  LocalDeckManifest,
  ManifestIssue,
  PendingFile,
  ProgressRecord,
  QuizResult,
  SchoolSubject,
  ShareExpiry,
  ShareRecord,
  SharedPackageInfo,
  StoredFile,
  ViewerConfiguration,
} from './models';

export interface LibraryRepository {
  listItems(): Promise<LibraryItem[]>;
  getItem(id: string): Promise<LibraryItem | undefined>;
  saveItem(item: LibraryItem): Promise<void>;
  updateItem(id: string, patch: Partial<LibraryItem>): Promise<void>;
  deleteItems(ids: string[]): Promise<void>;
  listCollections(): Promise<LibraryCollection[]>;
  saveCollection(c: LibraryCollection): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  listSubjects(): Promise<SchoolSubject[]>;
  saveSubject(s: SchoolSubject): Promise<void>;
  deleteSubject(id: string): Promise<void>;
  recordOpen(itemId: string): Promise<number | undefined>;
  finishSession(historyId: number, durationMs: number): Promise<void>;
  listHistory(): Promise<HistoryEntry[]>;
  clearHistory(): Promise<void>;
  addQuizResult(r: QuizResult): Promise<void>;
  setProgress(r: ProgressRecord): Promise<void>;
}

export interface FileStorage {
  putFiles(itemId: string, files: PendingFile[]): Promise<void>;
  listFiles(itemId: string): Promise<StoredFile[]>;
  getFile(itemId: string, path: string): Promise<StoredFile | undefined>;
  deleteFiles(itemId: string): Promise<void>;
  putArtwork(blob: Blob): Promise<string>;
  getArtwork(id: string): Promise<Blob | undefined>;
  deleteArtwork(id: string): Promise<void>;
}

export interface ImportService {
  /** Reads files and returns analysed jobs. Nothing is stored yet. */
  analyze(files: File[], opts?: { folder?: boolean }): Promise<ImportJob[]>;
  /** Persists one reviewed job. Resolves with the new item id. */
  commit(job: ImportJob, onProgress?: (p: number) => void): Promise<string>;
}

export interface MetadataService {
  validateManifest(input: unknown): { manifest?: LocalDeckManifest; issues: ManifestIssue[] };
  checkCompatibility(files: PendingFile[], entry: string): Promise<CompatibilityReport>;
}

export interface RuntimeService {
  isReady(): boolean;
  viewerFor(item: LibraryItem): Promise<ViewerConfiguration>;
}

export interface BackupService {
  exportLibrary(onProgress?: (p: number) => void): Promise<Blob>;
  exportItem(itemId: string): Promise<Blob>;
  restore(file: File): Promise<number>;
}

export interface SharingApi {
  /** false when no endpoint is configured; the UI shows a setup state. */
  isConfigured(): boolean;
  createShare(
    item: LibraryItem,
    opts: { expiry: ShareExpiry; allowDownload: boolean },
    onProgress?: (p: number) => void,
  ): Promise<ShareRecord>;
  revokeShare(record: ShareRecord): Promise<void>;
  fetchShare(remoteId: string, key: string): Promise<{ info: SharedPackageInfo; packageZip: Blob }>;
}
