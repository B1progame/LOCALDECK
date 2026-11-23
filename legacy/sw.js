const CACHE='localdeck-shell-v5';
const DB='localdeck-library-v1';
const STORE='projects';
const ASSETS=['./','./index.html','./styles.css','./polish.css','./app.js','./manifest.webmanifest','./favicon-64.png','./apple-touch-icon.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('localdeck-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
function getFile(id,path){return new Promise((resolve,reject)=>{const open=indexedDB.open(DB,1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const tx=open.result.transaction(STORE),req=tx.objectStore(STORE).get(id);req.onsuccess=()=>{const project=req.result;resolve(project?.files?.find(f=>f.path===path)?.blob||null);};req.onerror=()=>reject(req.error);};});}
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  const match=url.pathname.match(/\/__localdeck_game\/([^/]+)\/(.*)$/);
  if(match){event.respondWith((async()=>{try{const id=decodeURIComponent(match[1]),path=decodeURIComponent(match[2]);const blob=await getFile(id,path);if(!blob)return new Response('Project file not found',{status:404,headers:{'Content-Type':'text/plain'}});const headers=new Headers({'Content-Type':blob.type||'application/octet-stream','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','Cache-Control':'no-store'});if(url.searchParams.has('download'))headers.set('Content-Disposition','attachment');return new Response(blob,{headers});}catch{return new Response('Unable to load local project file',{status:500});}})());return;}
  if(event.request.method!=='GET'||url.origin!==location.origin)return;
  if(url.pathname.includes('/__localdeck_game/'))return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{if(response.ok&&url.origin===location.origin){const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}return response;}).catch(()=>caches.match('./index.html'))));
});
