export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function relativeTime(ts?: number): string {
  if (!ts) return 'Never';
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (abs < min) return 'Just now';
  if (abs < hr) return rtf.format(Math.round(diff / min), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / hr), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), 'day');
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDate(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return ms < 1000 ? '0 min' : '<1 min';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function dayGroup(ts: number): string {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  if (days < 31) return 'This month';
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function titleFromFilename(name: string): string {
  return name
    .replace(/\.(html?|zip|pdf)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (x) => x.toUpperCase()) || 'Untitled project';
}

const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  ico: 'image/x-icon', wasm: 'application/wasm', txt: 'text/plain', xml: 'application/xml', pdf: 'application/pdf',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', csv: 'text/csv', md: 'text/markdown',
};
export const extOf = (path: string): string => (path.split('/').pop() ?? '').split('.').pop()?.toLowerCase() ?? '';
export const mimeFor = (path: string): string => MIME[extOf(path)] ?? 'application/octet-stream';

export function assetGroup(path: string): string {
  const e = extOf(path);
  if (['html', 'htm'].includes(e)) return 'Pages';
  if (['js', 'mjs', 'wasm'].includes(e)) return 'Scripts';
  if (e === 'css') return 'Styles';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico'].includes(e)) return 'Images';
  if (['mp3', 'ogg', 'wav'].includes(e)) return 'Audio';
  if (['mp4', 'webm'].includes(e)) return 'Video';
  if (['woff', 'woff2', 'ttf', 'otf'].includes(e)) return 'Fonts';
  if (['glb', 'gltf'].includes(e)) return '3D models';
  if (['json', 'xml', 'csv', 'txt', 'md'].includes(e)) return 'Data';
  if (e === 'pdf') return 'Documents';
  return 'Other';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const slug = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
