/* Photos of a running project, used as its cover.
   A browser cannot look into a foreign frame, so the project itself draws the photo: LocalDeck puts a small script
   in front of it, runs it in an isolated frame without internet, and receives only a picture. */
import { mimeType } from './zip.ts';

export type PhotoFile = { path: string; blob: Blob };
export const PHOTO_WIDTH = 1200, PHOTO_HEIGHT = 750;
const MAX_FILE = 6 * 1024 * 1024, MAX_TOTAL = 40 * 1024 * 1024, MAX_SHIM = 12 * 1024 * 1024;

/** The frame may run scripts, nothing else. Everything it needs is inside the page. */
export const PHOTO_SANDBOX = 'allow-scripts';
const POLICY = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src data: blob:; worker-src data: blob:; form-action 'none'; base-uri 'none'";

const local = (reference: string) => Boolean(reference) && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference.trim());
/** Path of a file that `reference` in `from` means, without query and fragment. */
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

/** One page that contains the whole project, plus the photo script. */
export async function runnablePage(files: PhotoFile[], entryPath: string): Promise<string> {
  const byPath = new Map(files.map(file => [file.path.toLowerCase(), file]));
  const entry = byPath.get(entryPath.toLowerCase());
  if (!entry) throw new Error('no-entry');
  let budget = MAX_TOTAL;
  const cache = new Map<string, Promise<string | null>>();
  const find = (from: string, reference: string) => local(reference) ? byPath.get(resolvePath(from, reference).toLowerCase()) : undefined;
  const data = (file: PhotoFile, depth = 0): Promise<string | null> => {
    const known = cache.get(file.path);
    if (known) return known;
    const made = (async () => {
      if (file.blob.size > MAX_FILE || file.blob.size > budget) return null;
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
  const modules = (text: string, from: string, depth: number) => replaceAll(text, /(\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g, from, depth, (match, url) => `${match[1]}"${url}"`);

  const doc = new DOMParser().parseFromString(await entry.blob.text(), 'text/html');
  doc.querySelectorAll('meta[http-equiv], base').forEach(node => node.remove());
  for (const link of doc.querySelectorAll('link[href]')) {
    const file = find(entryPath, link.getAttribute('href')!);
    const url = file && /stylesheet/i.test(link.getAttribute('rel') ?? '') ? await data(file) : null;
    if (url) link.setAttribute('href', url); else link.remove();
  }
  for (const style of doc.querySelectorAll('style')) style.textContent = await styles(style.textContent ?? '', entryPath, 0);
  for (const script of doc.querySelectorAll('script:not([src])[type="module"]')) script.textContent = (await modules(script.textContent ?? '', entryPath, 0)).replace(/<\/(script)/gi, '<\\/$1');
  for (const element of doc.querySelectorAll('[src], [poster], image[href], use[href]')) for (const name of ['src', 'poster', 'href']) {
    const value = element.getAttribute(name);
    const file = value ? find(entryPath, value) : undefined;
    const url = file ? await data(file) : null;
    if (url) element.setAttribute(name, url);
  }
  for (const element of doc.querySelectorAll('[style*="url("]')) element.setAttribute('style', await styles(element.getAttribute('style')!, entryPath, 0));

  // Files that scripts load by name, such as new Image().src = "player.png".
  const named: Record<string, string> = {};
  let shim = 0;
  for (const file of files) {
    if (!/\.(png|jpe?g|gif|webp|avif|svg|json|txt|csv|mp3|ogg|wav)$/i.test(file.path) || file.path === 'localdeck.json' || shim + file.blob.size > MAX_SHIM) continue;
    shim += file.blob.size;
    const url = await data(file);
    if (url) named[file.path.toLowerCase()] = url;
  }
  const head = doc.head;
  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy'); policy.setAttribute('content', POLICY);
  const script = doc.createElement('script');
  script.textContent = `(${PHOTO_SCRIPT})(${JSON.stringify(named).split('<').join('\\u003c')},${JSON.stringify(entryPath.split('/').slice(0, -1).join('/').toLowerCase())})`;
  head.prepend(policy, script);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/* ---------- Inside the frame ---------- */

/** Runs before the project. Written as text, because it belongs to another document. */
export const PHOTO_SCRIPT = String.raw`function (files, folder) {
  var send = function (message) { window.parent.postMessage(message, '*'); };
  var byName = function (value) {
    var text = String(value || '');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(text)) return null;
    var parts = text[0] === '/' ? [] : folder ? folder.split('/') : [];
    text.replace(/[?#].*$/, '').split('/').forEach(function (part) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); });
    var path = parts.join('/').toLowerCase();
    try { path = decodeURIComponent(path); } catch (error) {}
    return Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null;
  };
  // A photo of a 3D canvas is empty unless the canvas keeps its picture.
  var context = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, options) {
    if (/webgl/.test(kind)) options = Object.assign({}, options, { preserveDrawingBuffer: true });
    return context.call(this, kind, options);
  };
  [[window.HTMLImageElement, 'src'], [window.HTMLMediaElement, 'src']].forEach(function (entry) {
    var own = Object.getOwnPropertyDescriptor(entry[0].prototype, entry[1]);
    Object.defineProperty(entry[0].prototype, entry[1], { configurable: true, enumerable: own.enumerable, get: own.get, set: function (value) { own.set.call(this, byName(value) || value); } });
  });
  var NativeAudio = window.Audio;
  window.Audio = function (value) { return value === undefined ? new NativeAudio() : new NativeAudio(byName(value) || value); };
  window.Audio.prototype = NativeAudio.prototype;
  var nativeFetch = window.fetch;
  window.fetch = function (value, options) { var url = byName(value && value.url || value); return nativeFetch.call(window, url || value, options); };
  // The project must not make noise while it is photographed.
  var play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { this.muted = true; return play.call(this); };
  ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
    var Native = window[name];
    if (!Native) return;
    window[name] = function (options) { var audio = new Native(options); try { audio.suspend(); audio.resume = function () { return Promise.resolve(); }; } catch (error) {} return audio; };
    window[name].prototype = Native.prototype;
  });

  var visible = function (element) { var box = element.getBoundingClientRect(), style = getComputedStyle(element); return box.width > 4 && box.height > 4 && box.bottom > 0 && box.top < innerHeight && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > .05; };
  var buttons = function () { return Array.prototype.filter.call(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a[href^="#"], [onclick]'), function (element) { return visible(element) && !element.disabled; }).slice(0, 20); };
  var label = function (element) { return String(element.innerText || element.value || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60); };
  var key = function (name, code, hold) {
    var target = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body;
    var make = function (kind) { var event = new KeyboardEvent(kind, { key: name, code: code, bubbles: true, cancelable: true }); Object.defineProperty(event, 'keyCode', { value: { Enter: 13, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[code] }); target.dispatchEvent(event); };
    make('keydown'); setTimeout(function () { make('keyup'); }, hold || 90);
  };
  var press = function (element) {
    var box = element.getBoundingClientRect(), at = { bubbles: true, cancelable: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, pointerId: 1, isPrimary: true, button: 0 };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (kind) { element.dispatchEvent(kind.indexOf('pointer') === 0 ? new PointerEvent(kind, at) : new MouseEvent(kind, at)); });
    if (element.click) element.click(); else element.dispatchEvent(new MouseEvent('click', at));
  };
  var start = function (index, moves) {
    var element = buttons()[index];
    if (element) press(element);
    else { var canvas = document.querySelector('canvas'); if (canvas) press(canvas); key('Enter', 'Enter'); setTimeout(function () { key(' ', 'Space'); }, 120); }
    if (!moves) return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    [['ArrowRight', 400], ['ArrowUp', 900], ['ArrowLeft', 1500], ['ArrowRight', 2100], ['ArrowUp', 2700], ['ArrowLeft', 3300]].forEach(function (move) { setTimeout(function () { key(move[0], move[0], 160); }, move[1]); });
  };

  var loaded = function (url) { return new Promise(function (resolve, reject) { var image = new Image(); image.onload = function () { resolve(image); }; image.onerror = reject; image.src = url; }); };
  var KEEP = ['position', 'top', 'right', 'bottom', 'left', 'display', 'margin', 'zIndex', 'transform', 'borderRadius', 'background', 'border', 'boxShadow', 'opacity', 'filter', 'flex', 'alignSelf', 'justifySelf', 'gridArea', 'order', 'imageRendering'];
  var background = function () {
    var found = '#fff';
    [document.documentElement, document.body].forEach(function (element) { var color = element && getComputedStyle(element).backgroundColor; if (color && !/rgba\(0, 0, 0, 0\)|transparent/.test(color)) found = color; });
    return found;
  };
  var page = function (width, height) {
    var root = document.documentElement, copy = root.cloneNode(true);
    var from = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*'))), to = [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('*')));
    from.forEach(function (element, index) {
      var twin = to[index];
      if (!twin) return;
      var name = element.tagName;
      if (name === 'CANVAS' || (name === 'IMG' && !/^data:/.test(element.currentSrc || element.src || ''))) {
        var picture = '';
        try {
          if (name === 'CANVAS') picture = element.toDataURL();
          else { var buffer = document.createElement('canvas'); buffer.width = element.naturalWidth; buffer.height = element.naturalHeight; context.call(buffer, '2d').drawImage(element, 0, 0); picture = buffer.toDataURL(); }
        } catch (error) {}
        var image = document.createElement('img'), style = getComputedStyle(element);
        KEEP.forEach(function (property) { image.style[property] = style[property]; });
        image.style.width = style.width; image.style.height = style.height; image.style.boxSizing = style.boxSizing; image.style.maxWidth = 'none';
        if (picture && picture.length > 10) image.setAttribute('src', picture);
        twin.replaceWith(image);
        return;
      }
      if (name === 'INPUT') { twin.setAttribute('value', element.value); if (element.checked) twin.setAttribute('checked', ''); else twin.removeAttribute('checked'); }
      if (name === 'TEXTAREA') twin.textContent = element.value;
      if (name === 'OPTION') { if (element.selected) twin.setAttribute('selected', ''); else twin.removeAttribute('selected'); }
      // In a copy every animation would start from the beginning, often invisible. Keep what is on the screen now.
      var now = twin.style && getComputedStyle(element);
      if (now && (now.animationName !== 'none' || (element.getAnimations && element.getAnimations().length))) {
        [['opacity', now.opacity], ['transform', now.transform], ['filter', now.filter], ['animation', 'none'], ['transition', 'none']].forEach(function (rule) { twin.style.setProperty(rule[0], rule[1], 'important'); });
      }
    });
    copy.querySelectorAll('script, noscript, link, style, meta, title, template, video, audio, iframe, object, embed').forEach(function (element) { element.remove(); });
    var css = '';
    Array.prototype.forEach.call(document.styleSheets, function (sheet) { try { Array.prototype.forEach.call(sheet.cssRules, function (rule) { css += rule.cssText + '\n'; }); } catch (error) {} });
    var style = document.createElement('style');
    style.textContent = css;
    copy.style.display = 'block'; copy.style.width = width + 'px'; copy.style.height = height + 'px'; copy.style.overflow = 'hidden';
    var body = copy.querySelector('body');
    if (body) { body.style.minHeight = height + 'px'; if (scrollY) body.style.marginTop = (-scrollY) + 'px'; body.appendChild(style); }
    var xml = new XMLSerializer().serializeToString(copy).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject width="100%" height="100%">' + xml + '</foreignObject></svg>');
  };
  var shoot = async function () {
    var width = innerWidth, height = innerHeight, canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    var g = context.call(canvas, '2d');
    g.fillStyle = background(); g.fillRect(0, 0, width, height);
    try { g.drawImage(await loaded(page(width, height)), 0, 0); return canvas.toDataURL('image/jpeg', .9); }
    catch (error) {
      // Some browsers do not let a page draw itself. The largest canvas is the next best picture.
      var best = null, area = 0;
      document.querySelectorAll('canvas').forEach(function (entry) { var size = entry.width * entry.height; if (size > area && visible(entry)) { area = size; best = entry; } });
      if (!best) throw error;
      var plain = document.createElement('canvas'); plain.width = width; plain.height = height;
      var p = context.call(plain, '2d'), scale = Math.max(width / best.width, height / best.height);
      p.fillStyle = background(); p.fillRect(0, 0, width, height);
      p.drawImage(best, (width - best.width * scale) / 2, (height - best.height * scale) / 2, best.width * scale, best.height * scale);
      return plain.toDataURL('image/jpeg', .9);
    }
  };
  window.addEventListener('message', function (event) {
    var message = event.data;
    if (event.source !== window.parent || !message || typeof message.localdeck !== 'string') return;
    event.stopImmediatePropagation();
    if (message.localdeck === 'list') send({ localdeck: 'list', id: message.id, buttons: buttons().map(label) });
    if (message.localdeck === 'start') start(message.index, message.moves);
    if (message.localdeck === 'shoot') shoot().then(function (url) { send({ localdeck: 'shot', id: message.id, url: url }); }, function () { send({ localdeck: 'shot', id: message.id, url: '' }); });
  });
  if (document.readyState === 'complete') send({ localdeck: 'ready' }); else window.addEventListener('load', function () { send({ localdeck: 'ready' }); });
}`;

/* ---------- Choosing ---------- */

const START = /^[^\p{L}\d]*(?:start(?:en|s)?|play|spiel(?:en)?\b|los(?:\s?geht|legen)?|beginn(?:en)?|begin|new game|neues spiel|go\b|jouer|commencer|démarrer|jugar|empezar|comenzar|iniciar|gioca|inizia|avvia|weiter spielen|shuffle|generate|sort)/iu;
const NEVER = /restart|neu ?start|reset|zurück|back|delete|lösch|login|sign|anmeld|share|teilen|einstell|setting|hilfe|help|info|close|schließ|copy|kopier|download/i;
/** Number of the button that starts a project, or -1. */
export function startButton(buttons: string[]): number {
  return buttons.findIndex(text => START.test(text) && !NEVER.test(text));
}

const AGAIN = /again|restart|retry|nochmal|erneut|noch einmal|neustart|rejouer|recommencer|otra vez|reintentar|de nuevo|riprova|ricomincia|ancora/i;
/** A start or game-over screen: the game waits for a click. */
export const waitsForPlayer = (buttons: string[]) => startButton(buttons) >= 0 || buttons.some(text => AGAIN.test(text));

/** How much there is to see, from 0 (one color) to 1. `pixels` are RGBA values of a small copy. */
export function photoScore(pixels: ArrayLike<number>, width: number): number {
  const colors = new Map<number, number>(), light: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const key = (pixels[i]! >> 5) << 6 | (pixels[i + 1]! >> 5) << 3 | pixels[i + 2]! >> 5;
    colors.set(key, (colors.get(key) ?? 0) + 1);
    light.push(.3 * pixels[i]! + .59 * pixels[i + 1]! + .11 * pixels[i + 2]!);
  }
  if (!light.length) return 0;
  const largest = Math.max(...colors.values()) / light.length;
  const mean = light.reduce((sum, value) => sum + value, 0) / light.length;
  const spread = Math.sqrt(light.reduce((sum, value) => sum + (value - mean) ** 2, 0) / light.length);
  let edges = 0;
  for (let i = 0; i < light.length; i++) if ((i + 1) % width && Math.abs(light[i]! - light[i + 1]!) > 24) edges++;
  return .35 * Math.min(1, (colors.size - 1) / 20) + .25 * Math.min(1, spread / 60) + .2 * Math.min(1, edges / light.length * 5) + .2 * (1 - largest);
}
