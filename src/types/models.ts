/**
 * LOCALDECK shared models.
 *
 * This file is the single source of truth for data shapes shared between the
 * UI, the local services in `src/services`, the service worker and any future
 * backend. See FRONTEND_HANDOFF.md for how each model is used.
 */

export const LIBRARY_ITEM_TYPES = [
  'game',
  'learning',
  'app',
  'tool',
  'simulation',
  'presentation',
  'document',
  'quiz',
] as const;
export type LibraryItemType = (typeof LIBRARY_ITEM_TYPES)[number];

export type InputMethod = 'keyboard' | 'mouse' | 'touch' | 'gamepad';
export type Orientation = 'any' | 'landscape' | 'portrait';
export type ScalingMode = 'fill' | 'fit-16-9' | 'fit-4-3' | 'fit-9-16';
export type ItemSource = 'html' | 'zip' | 'folder' | 'pdf' | 'backup' | 'shared' | 'demo';

export interface ItemArtwork {
  /** ids into the artwork table */
  cover?: string;
  banner?: string;
  icon?: string;
}

export interface CompatibilityReport {
  entryFound: boolean;
  externalDependencies: string[];
  missingAssets: string[];
  warnings: string[];
  /** true when no external dependency or missing asset was detected */
  offlineReady: boolean;
  checkedAt: number;
}

export interface LibraryItem {
  id: string;
  title: string;
  description: string;
  type: LibraryItemType;
  /** free-form secondary category: genre for games, category for apps */
  category: string;
  subjectId?: string;
  /** topic ids from the subject's topic tree, root first */
  topicPath: string[];
  tags: string[];
  language?: string;
  level?: string;
  inputMethods: InputMethod[];
  orientation: Orientation;
  scaling: ScalingMode;
  /** relative path of the file to open inside the package */
  entry: string;
  size: number;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  openCount: number;
  totalTimeMs: number;
  favorite: boolean;
  /** lower sorts first on the Favorites page */
  favoriteOrder?: number;
  pinned: boolean;
  artwork: ItemArtwork;
  /** content declares support for the LOCALDECK progress bridge */
  supportsProgress: boolean;
  compatibility: CompatibilityReport;
  source: ItemSource;
  manifestVersion?: number;
}

export interface StoredFile {
  itemId: string;
  path: string;
  blob: Blob;
  size: number;
  type: string;
}

export interface StoredArtwork {
  id: string;
  blob: Blob;
  createdAt: number;
}

export interface SmartRule {
  types?: LibraryItemType[];
  subjectId?: string;
  tag?: string;
  favoritesOnly?: boolean;
}

export interface LibraryCollection {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: CollectionIcon;
  coverArtworkId?: string;
  itemIds: string[];
  favorite: boolean;
  pinned: boolean;
  /** when present the collection is computed from metadata */
  smart?: SmartRule;
  createdAt: number;
  updatedAt: number;
}

export type CollectionIcon =
  | 'folder'
  | 'star'
  | 'gamepad'
  | 'book'
  | 'flask'
  | 'brush'
  | 'trophy'
  | 'cube'
  | 'school'
  | 'code';

export interface Topic {
  id: string;
  name: string;
  children: Topic[];
}

export type SubjectIcon =
  | 'sigma'
  | 'atom'
  | 'code'
  | 'languages'
  | 'landmark'
  | 'church'
  | 'leaf'
  | 'flask'
  | 'book'
  | 'globe'
  | 'music'
  | 'palette';

export interface SchoolSubject {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: SubjectIcon;
  coverArtworkId?: string;
  topics: Topic[];
  createdAt: number;
}

export interface HistoryEntry {
  id?: number;
  itemId: string;
  openedAt: number;
  durationMs: number;
}

/** Posted by compatible quiz content via the LOCALDECK bridge. */
export interface QuizResult {
  id?: number;
  itemId: string;
  at: number;
  correct: number;
  total: number;
  label?: string;
}

export interface ProgressRecord {
  itemId: string;
  /** 0..1 */
  progress: number;
  bookmark?: string;
  updatedAt: number;
}

/* ---------- Manifest ---------- */

export const MANIFEST_VERSION = 1;

export interface LocalDeckManifest {
  localdeck: number;
  title: string;
  type: LibraryItemType;
  description?: string;
  entry?: string;
  category?: string;
  subject?: string;
  topic?: string[];
  tags?: string[];
  language?: string;
  level?: string;
  input?: InputMethod[];
  orientation?: Orientation;
  offline?: boolean;
  artwork?: { cover?: string; banner?: string; icon?: string };
  progress?: boolean;
  author?: string;
  version?: string;
}

export interface ManifestIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/* ---------- Import ---------- */

export type ImportJobStatus = 'analyzing' | 'ready' | 'error' | 'importing' | 'done';
export type ImportKind = 'html' | 'zip' | 'folder' | 'pdf';

export interface PendingFile {
  path: string;
  blob: Blob;
}

export interface ImportDraft {
  title: string;
  description: string;
  type: LibraryItemType;
  category: string;
  subjectId?: string;
  tags: string[];
  language?: string;
  level?: string;
  inputMethods: InputMethod[];
  orientation: Orientation;
  entry: string;
  coverBlob?: Blob;
  bannerBlob?: Blob;
  iconBlob?: Blob;
}

export interface ImportJob {
  id: string;
  kind: ImportKind;
  sourceName: string;
  sourceSize: number;
  status: ImportJobStatus;
  progress: number;
  error?: string;
  files: PendingFile[];
  htmlEntries: string[];
  assetSummary: Record<string, number>;
  manifest?: LocalDeckManifest;
  manifestIssues: ManifestIssue[];
  compatibility?: CompatibilityReport;
  duplicateOf?: string;
  draft: ImportDraft;
  resultItemId?: string;
}

/* ---------- Sharing ---------- */

export type ShareStatus = 'uploading' | 'active' | 'expired' | 'revoked' | 'failed';
export type ShareExpiry = '1h' | '1d' | '7d' | '30d';

export interface ShareRecord {
  id: string;
  remoteId?: string;
  itemId: string;
  itemTitle: string;
  itemType: LibraryItemType;
  createdAt: number;
  expiresAt: number;
  status: ShareStatus;
  url?: string;
  sizeBytes: number;
  allowDownload: boolean;
  error?: string;
}

export interface SharedPackageInfo {
  title: string;
  description: string;
  type: LibraryItemType;
  category: string;
  sizeBytes: number;
  expiresAt: number;
  allowDownload: boolean;
}

/* ---------- Player ---------- */

export type ViewerKind = 'game' | 'reader' | 'app' | 'simulation' | 'document' | 'presentation';

export interface ViewerConfiguration {
  kind: ViewerKind;
  src: string;
  sandboxed: boolean;
  scaling: ScalingMode;
  orientation: Orientation;
  autoHideToolbar: boolean;
}

/* ---------- Settings ---------- */

export type ThemeId = 'obsidian' | 'midnight' | 'forest' | 'rose' | 'pearl' | 'system';
export type AnimationLevel = 'full' | 'reduced' | 'off';
export type Density = 'comfortable' | 'compact';
export type CardSize = 'small' | 'medium' | 'large';
export type ViewMode = 'grid' | 'compact' | 'list';
export type SortKey = 'recent' | 'added' | 'title' | 'size' | 'type';
export type HomeSectionId =
  | 'favorites'
  | 'continue'
  | 'recentlyAdded'
  | 'learning'
  | 'games'
  | 'apps'
  | 'collections'
  | 'quickAccess'
  | 'suggestions';

export interface ApplicationSettings {
  appearance: {
    theme: ThemeId;
    accent: string | null;
    animation: AnimationLevel;
    transparency: boolean;
    cardRadius: number;
    density: Density;
  };
  library: {
    defaultView: ViewMode;
    sort: SortKey;
    cardSize: CardSize;
    favoritesFirst: boolean;
  };
  home: {
    sections: { id: HomeSectionId; visible: boolean }[];
    featuredItemId: string | null;
    density: Density;
  };
  player: {
    preferFullscreen: boolean;
    scaling: ScalingMode;
    autoHideToolbar: boolean;
    confirmRestart: boolean;
  };
  imports: {
    duplicates: 'ask' | 'keep-both' | 'skip';
    detectMetadata: boolean;
    defaultType: LibraryItemType;
  };
  sharing: {
    endpoint: string;
    defaultExpiry: ShareExpiry;
    confirmUpload: boolean;
  };
  privacy: {
    trackHistory: boolean;
    trackTime: boolean;
  };
  accessibility: {
    reducedMotion: boolean;
    highContrast: boolean;
    largerText: boolean;
    keyboardHints: boolean;
  };
  onboardingDone: boolean;
  confirmDelete: boolean;
}

/* ---------- Diagnostics ---------- */

export type DiagnosticState = 'ok' | 'warn' | 'error' | 'unknown';

export interface DiagnosticResult {
  id: string;
  label: string;
  state: DiagnosticState;
  detail: string;
  help?: string;
}

export interface ErrorLogEntry {
  at: number;
  message: string;
  source: string;
}
