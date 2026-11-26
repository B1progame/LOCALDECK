const CACHE_PREFIX = 'localdeck-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v7`;
const BASE = new URL('./', self.location.href);
const PRECACHE = '__LOCALDECK_PRECACHE__';
const SHELL = ['.', 'index.html', 'manifest.webmanifest', 'favicon-64.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', ...(PRECACHE.startsWith('__') ? [] : JSON.parse(PRECACHE))];

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(SHELL.map(path => new URL(path, BASE).href));
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
  await self.clients.claim();
})()));

function mime(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  return ({html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',mp4:'video/mp4',webm:'video/webm',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',wasm:'application/wasm',pdf:'application/pdf',txt:'text/plain; charset=utf-8',xml:'application/xml'}[ext] || 'application/octet-stream');
}

function validPath(path) {
  return path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && !path.split('/').some(part => !part || part === '.' || part === '..');
}

/* ---------- What projects save ----------
   A project runs in an opaque origin, where the browser refuses localStorage and cookies. LocalDeck gives it a
   replacement: the saved values are written into its page when it opens, and changes come back here. Every project
   has its own record, and only a page of that project can change it. Nothing leaves the device. */
const SAVES_DB = 'localdeck-project-saves';
const SAVE_PATH = '__localdeck_save';
const MAX_SAVE = 5 * 1024 * 1024;

function openSaves() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SAVES_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readSave(itemId) {
  try {
    const db = await openSaves();
    return await new Promise(resolve => { const get = db.transaction('saves').objectStore('saves').get(itemId); get.onsuccess = () => { db.close(); resolve(get.result || null); }; get.onerror = () => { db.close(); resolve(null); }; });
  } catch { return null; }
}
async function writeSave(itemId, value) {
  const db = await openSaves();
  await new Promise((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put({ id: itemId, ...value, updatedAt: Date.now() }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
}

/** The project of a page, from its address, or null. */
function itemOf(url) {
  const relative = new URL(url).pathname.slice(BASE.pathname.length).split('/');
  if (relative[0] !== '__localdeck_asset' || !relative[1]) return null;
  try { const id = decodeURIComponent(relative[1]); return /^[a-zA-Z0-9-]{1,100}$/.test(id) ? id : null; } catch { return null; }
}
async function senderItem(event) {
  const client = event.clientId ? await self.clients.get(event.clientId) : null;
  return client ? itemOf(client.url) : null;
}

/** Accepts the saved values of a project, only from a page of the same project. */
async function saveProject(event, itemId) {
  const answer = (status) => new Response(null, { status, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
  if (await senderItem(event) !== itemId) return answer(403);
  const text = await event.request.text();
  if (text.length > MAX_SAVE) return answer(413);
  let value;
  try { value = JSON.parse(text); } catch { return answer(400); }
  const local = value && typeof value.local === 'object' && !Array.isArray(value.local) ? value.local : {};
  if (!Object.values(local).every(entry => typeof entry === 'string')) return answer(400);
  await writeSave(itemId, { local, cookies: typeof value.cookies === 'string' ? value.cookies.slice(0, 8192) : '' });
  return answer(204);
}

/** Runs first in every page of a project. Written as text, because it belongs to the page of the project. */
const STORAGE_SHIM = String.raw`(function (saved, endpoint, limit) {
  var timer = 0, cookies = typeof saved.cookies === 'string' ? saved.cookies : '';
  function persist() { clearTimeout(timer); timer = setTimeout(send, 250); }
  function send() { try { fetch(endpoint, { method: 'POST', body: JSON.stringify({ local: local.data, cookies: cookies }), headers: { 'Content-Type': 'text/plain' }, keepalive: true }); } catch (error) {} }
  function size(data) { var total = 0; for (var key in data) total += key.length + data[key].length; return total * 2; }
  function storage(data, keep) {
    var api = {
      data: data,
      getItem: function (key) { key = String(key); return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
      setItem: function (key, value) { key = String(key); value = String(value); var before = data[key]; data[key] = value; if (size(data) > limit) { if (before === undefined) delete data[key]; else data[key] = before; throw new DOMException('The storage of this project is full.', 'QuotaExceededError'); } if (keep) persist(); },
      removeItem: function (key) { delete data[String(key)]; if (keep) persist(); },
      clear: function () { for (var key in data) delete data[key]; if (keep) persist(); },
      key: function (index) { var keys = Object.keys(data); return index >= 0 && index < keys.length ? keys[index] : null; },
    };
    return new Proxy(api, {
      get: function (target, name) { if (name === 'length') return Object.keys(data).length; if (name in target) return target[name]; return typeof name === 'string' ? target.getItem(name) : undefined; },
      set: function (target, name, value) { if (name in target) return false; target.setItem(name, value); return true; },
      deleteProperty: function (target, name) { target.removeItem(name); return true; },
      has: function (target, name) { return name in target || Object.prototype.hasOwnProperty.call(data, name); },
      ownKeys: function () { return Object.keys(data); },
      getOwnPropertyDescriptor: function (target, name) { return Object.prototype.hasOwnProperty.call(data, name) ? { value: data[name], enumerable: true, configurable: true, writable: true } : undefined; },
    });
  }
  var local = storage(saved.local && typeof saved.local === 'object' ? saved.local : {}, true), session = storage({}, false);
  try { Object.defineProperty(window, 'localStorage', { value: local, configurable: true }); } catch (error) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: session, configurable: true }); } catch (error) {}
  try {
    Object.defineProperty(document, 'cookie', { configurable: true,
      get: function () { return cookies; },
      set: function (text) {
        var parts = String(text).split(';'), pair = parts[0], at = pair.indexOf('='), name = (at < 0 ? '' : pair.slice(0, at)).trim(), rest = parts.slice(1).join(';');
        var expires = /expires\s*=\s*([^;]+)/i.exec(rest);
        var gone = /max-age\s*=\s*-?0\b/i.test(rest) || (expires !== null && Date.parse(expires[1]) < Date.now());
        var list = cookies ? cookies.split('; ').filter(function (entry) { return entry.split('=')[0] !== name; }) : [];
        if (!gone && pair.trim()) list.push(pair.trim());
        cookies = list.join('; ').slice(0, 8192);
        persist();
      },
    });
  } catch (error) {}
  addEventListener('pagehide', send);
})`;

const encoder = new TextEncoder();
/** Puts the replacement storage at the start of an HTML page. The page itself is not decoded, so any encoding stays. */
async function withStorage(blob, itemId) {
  const saved = (await readSave(itemId)) || {};
  const endpoint = new URL(`__localdeck_asset/${encodeURIComponent(itemId)}/${SAVE_PATH}`, BASE).href;
  // Only ASCII, and never a closing script tag, whatever the project saved.
  const data = JSON.stringify({ local: saved.local || {}, cookies: saved.cookies || '' }).replace(/[\u007f-\uffff<>&]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const script = encoder.encode(`<script>${STORAGE_SHIM}(${data},${JSON.stringify(endpoint)},${MAX_SAVE});</script>`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // After the doctype, so the page keeps its standards mode.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const doctype = head.match(/^(?:\uFEFF|\u00EF\u00BB\u00BF)?\s*<!doctype[^>]*>/i);
  const at = doctype ? doctype[0].length : 0;
  return new Blob([bytes.subarray(0, at), script, bytes.subarray(at)], { type: blob.type });
}

async function projectAsset(requestUrl) {
  const relative = requestUrl.pathname.slice(BASE.pathname.length);
  const parts = relative.split('/');
  if (parts.shift() !== '__localdeck_asset' || parts.length < 2) return new Response('Not found', { status: 404 });
  let itemId, path;
  try {
    itemId = decodeURIComponent(parts.shift());
    path = parts.map(decodeURIComponent).join('/');
  } catch { return new Response('Invalid project path', { status: 400 }); }
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(itemId) || !validPath(path)) return new Response('Invalid project path', { status: 400 });
  const dbRequest = indexedDB.open('localdeck-library-v2');
  let internet = false;
  const record = await new Promise((resolve, reject) => {
    dbRequest.onerror = () => reject(dbRequest.error);
    dbRequest.onsuccess = () => {
      const db = dbRequest.result;
      if (!db.objectStoreNames.contains('assets')) { db.close(); resolve(null); return; }
      const tx = db.transaction(db.objectStoreNames.contains('items') ? ['assets', 'items'] : ['assets'], 'readonly');
      // The person allowed this project to use the internet (details of the project).
      if (db.objectStoreNames.contains('items')) { const item = tx.objectStore('items').get(itemId); item.onsuccess = () => { internet = item.result?.runtimeSettings?.internet === true; }; }
      const index = tx.objectStore('assets').index('[itemId+normalizedPath]');
      const get = index.get([itemId, path]);
      // Requests of one transaction finish in order, so the permission is known by now.
      get.onsuccess = () => { db.close(); resolve(get.result || null); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  });
  if (!record?.blob) return new Response('Project file not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const headers = new Headers({
    'Content-Type': record.mimeType || mime(path),
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  if (headers.get('Content-Type') !== 'application/pdf') {
    // The iframe needs a same-origin request so Safari can route it through
    // this service worker. This response policy makes its document opaque
    // again before any project script runs, keeping it isolated from LocalDeck.
    // It covers every file, not only .html: SVG, XML or a mislabelled file can
    // also run scripts when a frame navigates to it. Only PDFs are exempt,
    // because browsers refuse to show a sandboxed PDF and it runs no page script.
    // With the permission of the person, a project may also load from and talk to the internet. Its page stays opaque.
    const origin = internet ? `${requestUrl.origin} https:` : requestUrl.origin, socket = internet ? ' wss:' : '';
    headers.set('Content-Security-Policy', `sandbox allow-scripts allow-forms allow-pointer-lock allow-presentation allow-downloads allow-modals; default-src ${origin} data: blob:; script-src ${origin} 'unsafe-inline' 'unsafe-eval' blob:; style-src ${origin} 'unsafe-inline' blob:; img-src ${origin} data: blob:; font-src ${origin} data: blob:; media-src ${origin} data: blob:; connect-src ${origin} blob:${socket}; object-src 'none'; frame-src ${origin} blob:; form-action 'none'; base-uri ${requestUrl.origin}`);
    headers.set('Referrer-Policy', 'no-referrer');
  }
  if (requestUrl.searchParams.has('download')) headers.set('Content-Disposition', 'attachment');
  const html = /^text\/html/i.test(headers.get('Content-Type') || '') && !requestUrl.searchParams.has('download');
  return new Response(html ? await withStorage(record.blob, itemId) : record.blob, { headers });
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const assets = new URL('__localdeck_asset/', BASE).pathname;
  if (event.request.method === 'POST' && url.pathname.startsWith(assets) && url.pathname.endsWith(`/${SAVE_PATH}`)) {
    const itemId = itemOf(url.href);
    if (itemId) event.respondWith(saveProject(event, itemId).catch(() => new Response(null, { status: 500 })));
    return;
  }
  if (event.request.method !== 'GET') return;
  // A project that asks for "/style.css" means its own file, not one of the website.
  if (!url.pathname.startsWith(BASE.pathname) && event.clientId && event.request.mode !== 'navigate') {
    event.respondWith((async () => {
      const itemId = await senderItem(event);
      if (!itemId) return fetch(event.request);
      return projectAsset(new URL(`__localdeck_asset/${encodeURIComponent(itemId)}${url.pathname}${url.search}`, BASE));
    })().catch(() => new Response('Not found', { status: 404 })));
    return;
  }
  if (url.pathname.startsWith(new URL('__localdeck_asset/', BASE).pathname)) {
    event.respondWith(projectAsset(url).catch(() => new Response('Unable to read this project file from local storage.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })));
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(event.request); }
      catch { return (await caches.match(new URL('index.html', BASE).href)) || new Response('LOCALDECK is not available offline yet. Reconnect once to cache the app shell.', { status: 503 }); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok && url.origin === self.location.origin) (await caches.open(CACHE_NAME)).put(event.request, response.clone());
    return response;
  })());
});
