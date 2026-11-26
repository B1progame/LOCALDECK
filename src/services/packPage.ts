/* Turns a project of many files into one page that contains all of them as data addresses.
   An isolated frame (opaque origin) may not load anything from LocalDeck, not from the service worker and not from
   blob addresses of LocalDeck. It may load data addresses. So everything the page needs goes into the page. */
import { mimeType } from './zip.ts';

export type PackFile = { path: string; blob: Blob };
export type PackOptions = {
  /** Content-Security-Policy of the page. */
  policy: string;
  /** A script that runs before the project. Gets the files that scripts load by name, and the folder of the page. */
  prelude: (named: Record<string, string>, folder: string) => string;
  maxFile?: number;
  maxTotal?: number;
  /** Which files scripts may ask for by name, beyond those the page names itself. */
  named?: (path: string) => boolean;
};

const local = (reference: string) => Boolean(reference) && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference.trim());
/** Path of a file that `reference` in `from` means, without query and fragment. A path from the root means the root of the project. */
export function resolvePath(from: string, reference: string): string {
  const clean = reference.trim().replace(/[?#].*$/, '');
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { /* keep it as written */ }
  const folder = decoded.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of decoded.split('/')) { if (part === '..') folder.pop(); else if (part && part !== '.') folder.push(part); }
  return folder.join('/');
}

async function toDataUrl(blob: Blob, type: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

/** A script inside the page must not end it early. */
export const scriptText = (text: string) => text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
/** JSON that is safe inside a script. */
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export async function packPage(files: PackFile[], entryPath: string, options: PackOptions): Promise<string> {
  const { maxFile = 6 * 1024 * 1024, maxTotal = 40 * 1024 * 1024 } = options;
  const byPath = new Map(files.map(file => [file.path.toLowerCase(), file]));
  const entry = byPath.get(entryPath.toLowerCase());
  if (!entry) throw new Error('no-entry');
  let budget = maxTotal;
  const cache = new Map<string, Promise<string | null>>();
  const find = (from: string, reference: string) => local(reference) ? byPath.get(resolvePath(from, reference).toLowerCase()) : undefined;
  const data = (file: PackFile, depth = 0): Promise<string | null> => {
    const known = cache.get(file.path);
    if (known) return known;
    const made = (async () => {
      if (file.blob.size > maxFile || file.blob.size > budget) return null;
      budget -= file.blob.size;
      if (/\.css$/i.test(file.path)) return toDataUrl(new Blob([await styles(await file.blob.text(), file.path, depth)]), 'text/css');
      if (/\.m?js$/i.test(file.path)) return toDataUrl(new Blob([await modules(await file.blob.text(), file.path, depth)]), 'text/javascript');
      return toDataUrl(file.blob, mimeType(file.path));
    })();
    cache.set(file.path, made);
    return made;
  };
  const replaceAll = async (text: string, pattern: RegExp, from: string, depth: number, build: (match: RegExpMatchArray, url: string) => string) => {
    if (depth > 6) return text;
    let result = '', last = 0;
    for (const match of text.matchAll(pattern)) {
      const file = find(from, match[2] ?? '');
      const url = file ? await data(file, depth + 1) : null;
      if (!url) continue;
      result += text.slice(last, match.index) + build(match, url);
      last = match.index! + match[0].length;
    }
    return result + text.slice(last);
  };
  const styles = async (text: string, from: string, depth: number) => replaceAll(await replaceAll(text, /@import\s+(url\()?["']([^"')]+)["']\)?/gi, from, depth, (_, url) => `@import "${url}"`), /url\(\s{0,20}(["']?)([^"'()]{1,1000})\1\s{0,20}\)/gi, from, depth, (_, url) => `url("${url}")`);
  const modules = (text: string, from: string, depth: number) => replaceAll(text, /(\bfrom\s*|\bimport\s*\(?\s*)["']((?:\.{1,2})?\/[^"']+)["']/g, from, depth, (match, url) => `${match[1]}"${url}"`);

  const doc = new DOMParser().parseFromString(await entry.blob.text(), 'text/html');
  doc.querySelectorAll('meta[http-equiv], base').forEach(node => node.remove());
  for (const link of doc.querySelectorAll('link[href]')) {
    const file = find(entryPath, link.getAttribute('href')!);
    if (!file) continue;
    const url = /stylesheet|icon|preload|modulepreload/i.test(link.getAttribute('rel') ?? '') ? await data(file) : null;
    if (url) link.setAttribute('href', url); else link.remove();
  }
  for (const style of doc.querySelectorAll('style')) style.textContent = await styles(style.textContent ?? '', entryPath, 0);
  for (const script of doc.querySelectorAll('script:not([src])[type="module"]')) script.textContent = scriptText(await modules(script.textContent ?? '', entryPath, 0));
  for (const element of doc.querySelectorAll('[src], [poster], image[href], use[href], object[data]')) for (const name of ['src', 'poster', 'href', 'data']) {
    const value = element.getAttribute(name);
    if (name === 'href' && element.tagName.toLowerCase() === 'a') continue;
    const file = value ? find(entryPath, value) : undefined;
    const url = file ? await data(file) : null;
    if (url) element.setAttribute(name, url);
  }
  for (const element of doc.querySelectorAll('[srcset]')) element.removeAttribute('srcset');
  for (const element of doc.querySelectorAll('[style*="url("]')) element.setAttribute('style', await styles(element.getAttribute('style')!, entryPath, 0));

  // Files that scripts load by name, such as new Image().src = "player.png" or fetch("levels.json").
  const named: Record<string, string> = {};
  const wanted = options.named ?? (path => /\.(png|jpe?g|gif|webp|avif|svg|json|txt|csv|mp3|ogg|wav)$/i.test(path));
  for (const file of files) {
    if (file === entry || file.path === 'localdeck.json' || /\.html?$/i.test(file.path) || !wanted(file.path)) continue;
    const url = await data(file);
    if (url) named[file.path.toLowerCase()] = url;
  }
  const head = doc.head;
  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy'); policy.setAttribute('content', options.policy);
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  doc.querySelectorAll('meta[charset]').forEach(node => node.remove());
  const script = doc.createElement('script');
  script.textContent = options.prelude(named, entryPath.split('/').slice(0, -1).join('/').toLowerCase());
  head.prepend(charset, policy, script);
  // Keeps the standards mode of the page.
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
