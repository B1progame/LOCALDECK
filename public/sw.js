const CACHE_PREFIX = 'localdeck-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v6`;
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
  const record = await new Promise((resolve, reject) => {
    dbRequest.onerror = () => reject(dbRequest.error);
    dbRequest.onsuccess = () => {
      const db = dbRequest.result;
      if (!db.objectStoreNames.contains('assets')) { db.close(); resolve(null); return; }
      const tx = db.transaction('assets', 'readonly');
      const index = tx.objectStore('assets').index('[itemId+normalizedPath]');
      const get = index.get([itemId, path]);
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
    const origin = requestUrl.origin;
    headers.set('Content-Security-Policy', `sandbox allow-scripts allow-forms allow-pointer-lock allow-presentation allow-downloads; default-src ${origin} data: blob:; script-src ${origin} 'unsafe-inline' blob:; style-src ${origin} 'unsafe-inline' blob:; img-src ${origin} data: blob:; font-src ${origin} data: blob:; media-src ${origin} data: blob:; connect-src ${origin} blob:; object-src 'none'; frame-src ${origin} blob:; form-action 'none'; base-uri ${origin}`);
    headers.set('Referrer-Policy', 'no-referrer');
  }
  if (requestUrl.searchParams.has('download')) headers.set('Content-Disposition', 'attachment');
  return new Response(record.blob, { headers });
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
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
