import { CONTENT_TYPES, type CompatibilityReport, type ContentType, type ImportPreview, type ProjectManifest } from '../types.ts';
import { mimeType, normalizePackagePath, readZip, ZIP_LIMITS, type ZipEntry } from './zip.ts';

const MAX_IMPORT_BYTES = ZIP_LIMITS.maxExpandedBytes;

function titleFromFilename(name: string): string {
  return name.replace(/\.(html?|zip|pdf)$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled project';
}

function validManifest(value: unknown): ProjectManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const schemaVersion = data.schemaVersion === undefined ? 1 : data.schemaVersion;
  if (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1) return null;
  if (typeof data.title !== 'string' || !data.title.trim()) return null;
  if (data.type !== undefined && !CONTENT_TYPES.includes(data.type as ContentType)) return null;
  const optionalString = (key: string) => data[key] === undefined || typeof data[key] === 'string';
  for (const key of ['description','subject','topic','genre','cover','banner','icon','entry','language','version']) if (!optionalString(key)) return null;
  for (const key of ['tags','controls','features']) if (data[key] !== undefined && (!Array.isArray(data[key]) || !data[key].every(x => typeof x === 'string'))) return null;
  if (data.preferredOrientation !== undefined && !['any','portrait','landscape'].includes(String(data.preferredOrientation))) return null;
  if (data.offlineIntent !== undefined && typeof data.offlineIntent !== 'boolean') return null;
  return {
    schemaVersion: Number(schemaVersion), title: data.title.trim(), type: (data.type as ContentType | undefined) ?? 'other',
    ...(typeof data.id === 'string' ? { id: data.id } : {}),
    ...(typeof data.description === 'string' ? { description: data.description } : {}),
    ...(typeof data.format === 'string' ? { format: data.format as ProjectManifest['format'] } : {}),
    ...(typeof data.subject === 'string' ? { subject: data.subject } : {}), ...(typeof data.topic === 'string' ? { topic: data.topic } : {}),
    ...(typeof data.genre === 'string' ? { genre: data.genre } : {}),
    ...(Array.isArray(data.tags) ? { tags: data.tags as string[] } : {}), ...(Array.isArray(data.controls) ? { controls: data.controls as string[] } : {}),
    ...(typeof data.cover === 'string' ? { cover: data.cover } : {}), ...(typeof data.banner === 'string' ? { banner: data.banner } : {}), ...(typeof data.icon === 'string' ? { icon: data.icon } : {}),
    ...(typeof data.entry === 'string' ? { entry: data.entry } : {}), ...(typeof data.preferredOrientation === 'string' ? { preferredOrientation: data.preferredOrientation as ProjectManifest['preferredOrientation'] } : {}),
    ...(Array.isArray(data.features) ? { features: data.features as string[] } : {}), ...(typeof data.language === 'string' ? { language: data.language } : {}),
    ...(typeof data.version === 'string' ? { version: data.version } : {}), ...(typeof data.offlineIntent === 'boolean' ? { offlineIntent: data.offlineIntent } : {}),
  };
}

function parseEmbeddedManifest(html: string): { manifest: ProjectManifest | null; warning?: string } {
  const match = html.match(/<script\b(?=[^>]*\bid\s*=\s*["']localdeck-manifest["'])(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/i);
  if (!match) return { manifest: null };
  try {
    const parsed = validManifest(JSON.parse(match[1]));
    return parsed ? { manifest: parsed } : { manifest: null, warning: 'The embedded LocalDeck manifest did not match the supported metadata format.' };
  } catch { return { manifest: null, warning: 'The embedded LocalDeck manifest contains invalid JSON.' }; }
}

export function diagnoseCompatibility(entryHtml: string, packagePaths: string[] = [], entryPath = 'index.html'): CompatibilityReport {
  const findings: string[] = [];
  const localPaths = new Set(packagePaths.map(path => path.toLocaleLowerCase('en-US')));
  const references = new Set<string>();
  for (const match of entryHtml.matchAll(/\b(?:src|href|poster|data)\s*=\s*(["'])(.*?)\1/gi)) references.add(match[2].trim());
  for (const match of entryHtml.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) references.add(match[2].trim());
  for (const match of entryHtml.matchAll(/@import\s+(?:url\()?\s*(["'])(.*?)\1\s*\)?/gi)) references.add(match[2].trim());
  const external = [...references].filter(ref => /^https?:\/\//i.test(ref) || ref.startsWith('//'));
  if (external.length) findings.push(`${external.length} remote file reference${external.length === 1 ? '' : 's'} detected. The isolated player blocks remote scripts, images, fonts, and styles; they may also be unavailable offline.`);
  const missing = new Set<string>();
  for (const ref of references) {
    if (!ref || external.includes(ref) || /^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(ref)) continue;
    try {
      const url = new URL(ref, `https://localdeck.invalid/${entryPath}`);
      if (url.origin !== 'https://localdeck.invalid') continue;
      let path = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      path = normalizePackagePath(path);
      if (localPaths.size && !localPaths.has(path.toLocaleLowerCase('en-US'))) missing.add(path);
      if (ref.startsWith('/')) missing.add(ref);
    } catch { missing.add(ref); }
  }
  if (missing.size) findings.push(`${missing.size} local file reference${missing.size === 1 ? '' : 's'} could not be matched to the package: ${[...missing].slice(0,3).join(', ')}${missing.size > 3 ? ', …' : ''}.`);
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/i.test(entryHtml)) findings.push('The page appears to use network requests. The isolated player restricts requests to local project files and offline cache.');
  if (/serviceWorker|navigator\.serviceWorker/i.test(entryHtml)) findings.push('The project references its own service worker; embedded projects cannot register one from the isolated player.');
  if (/\btype\s*=\s*["']module["']/i.test(entryHtml)) findings.push('The entry page uses JavaScript modules. Modules with multi-file local imports need to pass the compatibility check in the player.');
  if (/\b(?:indexedDB|localStorage|sessionStorage)\b/.test(entryHtml)) findings.push('The isolated player does not share LOCALDECK storage. Project-owned storage may be unavailable in the opaque sandbox.');
  if (!findings.length) findings.push('No common remote-resource, missing-file, or server dependency was found in the entry page. Runtime compatibility still depends on the project code and browser.');
  return { score: findings.some(x => /remote|network|server|service worker|missing|could not be matched/i.test(x)) ? 'partial' : 'likely', findings, checkedAt: Date.now() };
}

function commonRoot(entries: ZipEntry[]): string | null {
  if (!entries.length) return null;
  const segments = entries.map(x => x.path.split('/'));
  const first = segments[0][0];
  return first && segments.every(parts => parts.length > 1 && parts[0] === first) ? first : null;
}

function chooseEntries(entries: ZipEntry[]): ZipEntry[] {
  const root = commonRoot(entries);
  const mapped = entries.map(entry => ({
    path: root ? entry.path.slice(root.length + 1) : entry.path,
    blob: entry.blob,
  })).filter(x => x.path.length > 0);
  const paths = new Set<string>();
  const lowerPaths = new Set<string>();
  for (const entry of mapped) {
    const path = normalizePackagePath(entry.path);
    const lower = path.toLocaleLowerCase('en-US');
    if (paths.has(path) || lowerPaths.has(lower)) throw new Error(`The package contains duplicate or case-colliding paths: ${path}`);
    paths.add(path); lowerPaths.add(lower);
  }
  return mapped;
}

function candidateEntries(entries: ZipEntry[]): string[] {
  const html = entries.filter(x => /\.html?$/i.test(x.path));
  const visible = html.filter(x => !x.path.split('/').some(segment => segment.startsWith('.') || ['node_modules','vendor'].includes(segment.toLowerCase())));
  const pool = visible.length ? visible : html;
  return pool.sort((a, b) => {
    const aIndex = /(^|\/)index\.html?$/i.test(a.path) ? -1 : 0;
    const bIndex = /(^|\/)index\.html?$/i.test(b.path) ? -1 : 0;
    return aIndex - bIndex || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path);
  }).map(x => x.path);
}

async function hashBlob(blob: Blob): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}

function buildPreview(sourceName: string, entries: ZipEntry[], manifest: ProjectManifest | null, warnings: string[], documentFile = false): ImportPreview {
  const entryCandidates = documentFile ? [entries[0]?.path ?? sourceName] : candidateEntries(entries);
  if (!entryCandidates.length) throw new Error('No HTML entry page was found. Include an .html or .htm file in the project.');
  const selectedEntry = manifest?.entry && entryCandidates.includes(manifest.entry) ? manifest.entry : entryCandidates[0];
  const offlineCompatibility: CompatibilityReport = documentFile
    ? { score: 'likely' as const, findings: ['PDF viewing depends on the browser PDF viewer.'], checkedAt: Date.now() }
    : { score: 'unknown' as const, findings: ['Compatibility will be checked against the selected entry page.'], checkedAt: Date.now() };
  const base: Omit<ImportPreview, 'files' | 'report'> = {
    id: crypto.randomUUID(),
    sourceName,
    entryCandidates,
    selectedEntry,
    manifest,
    warnings,
    type: documentFile ? 'document' : manifest?.type ?? 'other',
    title: manifest?.title ?? titleFromFilename(sourceName),
    description: manifest?.description ?? '', subject: manifest?.subject ?? '', topic: manifest?.topic ?? '', tags: manifest?.tags ?? [],
    storageSize: entries.reduce((sum, x) => sum + x.blob.size, 0),
  };
  return { ...base, files: [], report: offlineCompatibility };
}

async function attachFileData(preview: ImportPreview, entries: ZipEntry[]): Promise<ImportPreview> {
  const files = await Promise.all(entries.map(async item => ({
    path: normalizePackagePath(item.path), blob: item.blob, mimeType: item.blob.type || mimeType(item.path),
    size: item.blob.size, contentHash: await hashBlob(item.blob),
  })));
  const entry = entries.find(x => x.path === preview.selectedEntry);
  const entryText = entry && entry.blob.type === 'text/html' ? await entry.blob.text() : '';
  return {
    ...preview,
    files,
    report: preview.type === 'document'
      ? { score: 'likely', findings: ['PDF viewing depends on the browser PDF viewer.'], checkedAt: Date.now() }
      : diagnoseCompatibility(entryText, entries.map(x => x.path), preview.selectedEntry),
  };
}

async function manifestFor(entries: ZipEntry[]): Promise<{ manifest: ProjectManifest | null; warnings: string[] }> {
  const warnings: string[] = [];
  const file = entries.find(x => x.path.toLowerCase() === 'localdeck.json');
  if (file) {
    try {
      const raw = JSON.parse(await file.blob.text());
      const manifest = validManifest(raw);
      if (!manifest) warnings.push('localdeck.json did not match the supported metadata format; default details were used.');
      else if (manifest.schemaVersion > 1) warnings.push(`This project uses manifest version ${manifest.schemaVersion}; unknown fields were preserved in the package but are not shown in the library.`);
      else return { manifest, warnings };
      if (manifest) return { manifest, warnings };
    } catch { warnings.push('localdeck.json is invalid JSON; default details were used.'); }
  }
  const htmlEntries = candidateEntries(entries);
  const preferred = htmlEntries[0] && entries.find(x => x.path === htmlEntries[0]);
  if (preferred) {
    const parsed = parseEmbeddedManifest(await preferred.blob.text());
    if (parsed.warning) warnings.push(parsed.warning);
    return { manifest: parsed.manifest, warnings };
  }
  return { manifest: null, warnings };
}

async function packagePreview(name: string, original: ZipEntry[], initialWarnings: string[] = []): Promise<ImportPreview> {
  if (!original.length) throw new Error('This package is empty.');
  const entries = chooseEntries(original);
  const totalSize = entries.reduce((sum, x) => sum + x.blob.size, 0);
  if (totalSize > MAX_IMPORT_BYTES) throw new Error('This project is larger than LOCALDECK’s 120 MB browser import limit.');
  const { manifest, warnings } = await manifestFor(entries);
  return attachFileData(buildPreview(name, entries, manifest, [...initialWarnings, ...warnings]), entries);
}

export async function analyzeFiles(input: FileList | File[]): Promise<ImportPreview[]> {
  const selected = [...input];
  if (!selected.length) return [];
  const total = selected.reduce((sum, x) => sum + x.size, 0);
  if (total > MAX_IMPORT_BYTES) throw new Error('The selected files exceed the 120 MB import limit. Try importing a smaller project.');
  const results: ImportPreview[] = [];
  const folderFiles = selected.filter(file => 'webkitRelativePath' in file && Boolean((file as File & { webkitRelativePath?: string }).webkitRelativePath));
  const standalone = selected.filter(file => !folderFiles.includes(file));

  if (folderFiles.length) {
    const oversized = folderFiles.find(file => file.size > ZIP_LIMITS.maxFileBytes);
    if (oversized) throw new Error(`${oversized.name} exceeds the 50 MB per-file import limit.`);
    const root = (folderFiles[0] as File & { webkitRelativePath: string }).webkitRelativePath.split('/')[0];
    const entries = await Promise.all(folderFiles.map(async file => {
      const relative = (file as File & { webkitRelativePath: string }).webkitRelativePath;
      const path = relative.startsWith(`${root}/`) ? relative.slice(root.length + 1) : relative;
      const normalized = normalizePackagePath(path);
      return { path: normalized, blob: new Blob([await file.arrayBuffer()], { type: file.type || mimeType(normalized) }) };
    }));
    results.push(await packagePreview(root || 'Imported folder', entries));
  }

  for (const file of standalone) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.zip')) {
      if (file.size > ZIP_LIMITS.maxProjectArchiveBytes) throw new Error('Project ZIP files are limited to 80 MB.');
      const entries = await readZip(file);
      results.push(await packagePreview(file.name, entries));
    } else if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      if (file.size > ZIP_LIMITS.maxFileBytes) throw new Error(`${file.name} exceeds the 50 MB per-file import limit.`);
      const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (new TextDecoder().decode(header) !== '%PDF-') throw new Error(`${file.name} does not look like a valid PDF file.`);
      const entry = { path: normalizePackagePath(file.name), blob: new Blob([await file.arrayBuffer()], { type: 'application/pdf' }) };
      const preview = buildPreview(file.name, [entry], { schemaVersion: 1, title: titleFromFilename(file.name), type: 'document', format: 'pdf' }, [], true);
      results.push(await attachFileData(preview, [entry]));
    } else if (/\.html?$/i.test(name) || file.type === 'text/html') {
      if (file.size > ZIP_LIMITS.maxFileBytes) throw new Error(`${file.name} exceeds the 50 MB per-file import limit.`);
      const entry = { path: normalizePackagePath(file.name), blob: new Blob([await file.arrayBuffer()], { type: 'text/html' }) };
      const parsed = parseEmbeddedManifest(await entry.blob.text());
      const warnings = parsed.warning ? [parsed.warning] : [];
      if (parsed.manifest?.schemaVersion && parsed.manifest.schemaVersion > 1) warnings.push(`This project uses manifest version ${parsed.manifest.schemaVersion}; only recognized fields are used.`);
      const preview = buildPreview(file.name, [entry], parsed.manifest, warnings);
      results.push(await attachFileData(preview, [entry]));
    } else {
      throw new Error(`${file.name} is not an HTML file, ZIP package, or PDF document.`);
    }
  }
  return results;
}

