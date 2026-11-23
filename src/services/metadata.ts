import {
  LIBRARY_ITEM_TYPES,
  MANIFEST_VERSION,
  type CompatibilityReport,
  type InputMethod,
  type LibraryItemType,
  type LocalDeckManifest,
  type ManifestIssue,
  type PendingFile,
} from '@/types/models';
import type { MetadataService } from '@/types/services';

const INPUTS: InputMethod[] = ['keyboard', 'mouse', 'touch', 'gamepad'];
const LEGACY_TYPES: Record<string, LibraryItemType> = { other: 'app', learn: 'learning', pdf: 'document' };

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function validateManifest(input: unknown): { manifest?: LocalDeckManifest; issues: ManifestIssue[] } {
  const issues: ManifestIssue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { issues: [{ path: '$', message: 'The manifest must be a JSON object.', severity: 'error' }] };
  }
  const o = input as Record<string, unknown>;
  const version = typeof o.localdeck === 'number' ? o.localdeck : undefined;
  if (version === undefined) issues.push({ path: 'localdeck', message: `Add "localdeck": ${MANIFEST_VERSION} so future versions can read this file.`, severity: 'warning' });
  else if (version > MANIFEST_VERSION) issues.push({ path: 'localdeck', message: `Manifest version ${version} is newer than this app supports (${MANIFEST_VERSION}).`, severity: 'warning' });

  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (!title) issues.push({ path: 'title', message: 'A title is required.', severity: 'error' });
  else if (title.length > 120) issues.push({ path: 'title', message: 'Keep the title under 120 characters.', severity: 'warning' });

  let type: LibraryItemType = 'app';
  if (typeof o.type === 'string') {
    const t = o.type.toLowerCase();
    if ((LIBRARY_ITEM_TYPES as readonly string[]).includes(t)) type = t as LibraryItemType;
    else if (LEGACY_TYPES[t]) { type = LEGACY_TYPES[t]; issues.push({ path: 'type', message: `"${o.type}" was read as "${type}".`, severity: 'warning' }); }
    else issues.push({ path: 'type', message: `Unknown type "${o.type}". Use one of: ${LIBRARY_ITEM_TYPES.join(', ')}.`, severity: 'error' });
  } else issues.push({ path: 'type', message: 'A type is required.', severity: 'error' });

  const optStr = (k: string): string | undefined => {
    if (o[k] === undefined) return undefined;
    if (typeof o[k] === 'string') return o[k] as string;
    issues.push({ path: k, message: `"${k}" must be text.`, severity: 'error' });
    return undefined;
  };
  const optArr = (k: string): string[] | undefined => {
    if (o[k] === undefined) return undefined;
    if (isStrArr(o[k])) return o[k] as string[];
    issues.push({ path: k, message: `"${k}" must be a list of text values.`, severity: 'error' });
    return undefined;
  };

  const input_ = optArr('input');
  const badInput = input_?.filter((x) => !INPUTS.includes(x as InputMethod));
  if (badInput?.length) issues.push({ path: 'input', message: `Unknown input methods: ${badInput.join(', ')}.`, severity: 'warning' });

  const orientation = optStr('orientation');
  if (orientation && !['any', 'landscape', 'portrait'].includes(orientation)) issues.push({ path: 'orientation', message: 'Orientation must be any, landscape or portrait.', severity: 'error' });

  let artwork: LocalDeckManifest['artwork'];
  if (o.artwork !== undefined) {
    if (typeof o.artwork === 'object' && o.artwork !== null) {
      const a = o.artwork as Record<string, unknown>;
      artwork = {};
      for (const k of ['cover', 'banner', 'icon'] as const) {
        if (a[k] === undefined) continue;
        if (typeof a[k] === 'string') artwork[k] = a[k] as string;
        else issues.push({ path: `artwork.${k}`, message: 'Artwork entries must be relative file paths.', severity: 'error' });
      }
    } else issues.push({ path: 'artwork', message: '"artwork" must be an object.', severity: 'error' });
  }

  const entry = optStr('entry');
  if (entry && (entry.startsWith('/') || entry.includes('..') || /^https?:/i.test(entry))) issues.push({ path: 'entry', message: 'The entry must be a relative path inside the package.', severity: 'error' });

  const manifest: LocalDeckManifest = {
    localdeck: version ?? MANIFEST_VERSION,
    title: title || 'Untitled project',
    type,
    description: optStr('description'),
    entry,
    category: optStr('category') ?? optStr('genre'),
    subject: optStr('subject'),
    topic: optArr('topic'),
    tags: optArr('tags'),
    language: optStr('language'),
    level: optStr('level'),
    input: input_?.filter((x): x is InputMethod => INPUTS.includes(x as InputMethod)),
    orientation: orientation as LocalDeckManifest['orientation'],
    offline: typeof o.offline === 'boolean' ? o.offline : undefined,
    artwork,
    progress: typeof o.progress === 'boolean' ? o.progress : undefined,
    author: optStr('author'),
    version: optStr('version'),
  };
  return { manifest, issues };
}

/** Reads `<script type="application/localdeck+json">` from a standalone HTML file. */
export function readEmbeddedManifest(html: string): unknown | undefined {
  const m = html.match(/<script[^>]+type=["']application\/localdeck\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m?.[1]) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return { __parseError: true };
  }
}

const REF_RE = /(?:src|href|data-src|poster)\s*=\s*["']([^"'#]+)["']|url\(\s*["']?([^"')]+)["']?\s*\)|import\s+(?:[^'"]*from\s+)?["']([^"']+)["']/gi;
const KNOWN_CDNS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'code.jquery.com', 'cdn.tailwindcss.com', 'esm.sh', 'ajax.googleapis.com'];

function resolvePath(base: string, ref: string): string {
  const parts = base.split('/').slice(0, -1);
  for (const seg of ref.split('?')[0]!.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

export async function checkCompatibility(files: PendingFile[], entry: string): Promise<CompatibilityReport> {
  const paths = new Set(files.map((f) => f.path));
  const lower = new Set(files.map((f) => f.path.toLowerCase()));
  const external = new Set<string>();
  const missing = new Set<string>();
  const warnings: string[] = [];
  const textFiles = files.filter((f) => /\.(html?|css|m?js)$/i.test(f.path) && f.blob.size < 5_000_000);
  for (const f of textFiles) {
    const text = await f.blob.text();
    for (const m of text.matchAll(REF_RE)) {
      const ref = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!ref || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('javascript:') || ref.startsWith('mailto:') || ref.startsWith('#') || ref.includes('${')) continue;
      if (/^(https?:)?\/\//i.test(ref)) {
        try {
          external.add(new URL(ref, 'https://x.invalid').host);
        } catch {
          /* ignore malformed */
        }
        continue;
      }
      if (ref.startsWith('/')) { warnings.push(`${f.path} uses the absolute path “${ref}”. Use a relative path so it works inside LOCALDECK.`); continue; }
      if (!/\.[a-z0-9]{2,5}$/i.test(ref.split('?')[0]!)) continue; // likely a route or bare module name
      if (/\.m?js$/i.test(f.path) && !/^\.{1,2}\//.test(ref)) continue;
      const resolved = resolvePath(f.path, ref);
      if (!paths.has(resolved)) {
        if (lower.has(resolved.toLowerCase())) warnings.push(`“${ref}” in ${f.path} differs only in letter case from a packaged file.`);
        else missing.add(resolved);
      }
    }
  }
  const entryFound = paths.has(entry);
  const ext = [...external];
  if (ext.some((h) => KNOWN_CDNS.includes(h))) warnings.push('Libraries or fonts load from a CDN. Download them into the package so the project works offline.');
  return {
    entryFound,
    externalDependencies: ext,
    missingAssets: [...missing].slice(0, 50),
    warnings: [...new Set(warnings)].slice(0, 20),
    offlineReady: entryFound && ext.length === 0 && missing.size === 0,
    checkedAt: Date.now(),
  };
}

export const metadataService: MetadataService = { validateManifest, checkCompatibility };

export function manifestToJSON(m: LocalDeckManifest): string {
  const clean = Object.fromEntries(
    Object.entries(m).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)),
  );
  return JSON.stringify(clean, null, 2);
}

export function embeddedSnippet(m: LocalDeckManifest): string {
  return `<script type="application/localdeck+json">\n${manifestToJSON(m)}\n</script>`;
}
