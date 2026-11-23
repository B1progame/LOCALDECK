export const CONTENT_TYPES = ['game', 'learning', 'app', 'tool', 'simulation', 'presentation', 'document', 'quiz', 'other'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export type ArtworkReferences = { cover?: string; banner?: string; icon?: string; screenshots?: string[] };
export type RuntimeSettings = { preferredOrientation?: 'any' | 'portrait' | 'landscape'; fullscreen?: boolean };
export type CompatibilityReport = {
  score: 'likely' | 'partial' | 'unknown';
  findings: string[];
  checkedAt: number;
};

export interface LibraryItem {
  id: string;
  title: string;
  type: ContentType;
  description: string;
  subject: string;
  topic: string;
  genre: string;
  tags: string[];
  collectionIds: string[];
  favorite: boolean;
  artworkReferences: ArtworkReferences;
  entryFile: string;
  originalFilename: string;
  storageSize: number;
  manifestVersion: number;
  createdAt: number;
  updatedAt: number;
  importedAt: number;
  lastOpenedAt: number | null;
  openCount: number;
  runtimeSettings: RuntimeSettings;
  offlineCompatibility: CompatibilityReport;
  packageId: string;
  fileCount: number;
}

export interface LibraryAsset {
  id: string;
  itemId: string;
  normalizedPath: string;
  mimeType: string;
  fileSize: number;
  contentHash: string;
  blob: Blob;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  cover?: string;
  accentColor: string;
  orderedItemIds: string[];
  smartRule?: { type?: ContentType; subject?: string; favorite?: boolean };
  createdAt: number;
  updatedAt: number;
}

export interface Subject {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  parentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UsageRecord {
  id: string;
  itemId: string;
  openedAt: number;
  durationMs?: number;
  sessionMetadata?: Record<string, string | number | boolean>;
}

export interface AppSettings {
  id: string;
  value: unknown;
  updatedAt: number;
}

export interface ImportJob {
  id: string;
  source: string;
  status: 'inspecting' | 'ready' | 'committing' | 'complete' | 'failed' | 'cancelled';
  progress: number;
  detectedFiles: string[];
  validationErrors: string[];
  completionState: 'pending' | 'stored' | 'verified' | 'rolled-back';
  createdAt: number;
  updatedAt: number;
}

export interface ProjectManifest {
  schemaVersion: number;
  id?: string;
  title: string;
  description?: string;
  type: ContentType;
  format?: 'html' | 'pdf' | 'web';
  subject?: string;
  topic?: string;
  genre?: string;
  tags?: string[];
  cover?: string;
  banner?: string;
  icon?: string;
  entry?: string;
  controls?: string[];
  preferredOrientation?: 'any' | 'portrait' | 'landscape';
  features?: string[];
  language?: string;
  version?: string;
  offlineIntent?: boolean;
}

export interface ImportPreview {
  id: string;
  sourceName: string;
  files: Array<{ path: string; blob: Blob; mimeType: string; size: number; contentHash: string }>;
  entryCandidates: string[];
  selectedEntry: string;
  manifest: ProjectManifest | null;
  warnings: string[];
  type: ContentType;
  title: string;
  description: string;
  subject: string;
  topic: string;
  tags: string[];
  storageSize: number;
  report: CompatibilityReport;
}
