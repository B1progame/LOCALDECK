(() => {
  'use strict';
  const DB_NAME = 'localdeck-library-v1';
  const STORE = 'projects';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const state = { items: [], page: location.hash.slice(1) || 'home', query: '', sort: 'recent', view: 'grid', category: 'All items', currentPlayer: null, collectionFilter: '' };
  const pageNames = {home:'Home',library:'All items',favorites:'Favorites',recent:'Recently opened',learning:'Learning hub',games:'Games & apps',collections:'Collections',import:'Import center',studio:'AI studio',settings:'Settings',storage:'Storage & backups'};
  const basePath = new URL('./', location.href).pathname;
  let db;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, {keyPath:'id'}); };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }
  function dbAll() { return new Promise((resolve,reject) => { const r=db.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess=()=>resolve(r.result||[]); r.onerror=()=>reject(r.error); }); }
  function dbPut(value) { return new Promise((resolve,reject) => { const r=db.transaction(STORE,'readwrite').objectStore(STORE).put(value); r.onsuccess=()=>resolve(value); r.onerror=()=>reject(r.error); }); }
  function dbDelete(id) { return new Promise((resolve,reject) => { const r=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id); r.onsuccess=resolve; r.onerror=()=>reject(r.error); }); }
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bytes = n => n < 1024*1024 ? `${n<=0?0:Math.max(1,Math.round(n/1024))} KB` : `${(n/1024/1024).toFixed(1)} MB`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const niceType = t => ({learning:'Learning',game:'Game',app:'App',simulation:'Simulation',presentation:'Presentation',tool:'Tool',other:'Project'}[t] || 'Project');
  const coverClass = item => item.coverClass || (item.type === 'learning' ? (item.subject?.toLowerCase().includes('phys') ? 'cover-science' : 'cover-math') : item.type === 'game' ? 'cover-game' : 'cover-tool');

  function toast(message, error = false) {
    const el = document.createElement('div'); el.className = `toast${error?' error':''}`; el.innerHTML = `<i>${error?'!':'✓'}</i><span>${esc(message)}</span>`; $('#toasts').append(el); setTimeout(()=>el.remove(),3800);
  }
  function actionDialog({title,description='',fields=[],submit='Save changes',cancel='Cancel',danger=false}) {
    const dialog=$('#actionDialog'),form=$('#actionForm'),area=$('#actionFields'),confirm=$('#actionSubmit');
    $('#actionTitle').textContent=title;$('#actionDescription').textContent=description;confirm.textContent=submit;confirm.classList.toggle('danger-action',danger);
    area.innerHTML=fields.map((field,i)=>{
      if(field.kind==='checks')return `<div class="action-checks">${field.options.map((option,j)=>`<label class="action-check"><input type="checkbox" data-field="${esc(field.name)}" value="${esc(option.value)}" ${field.value?.includes(option.value)?'checked':''}><span>${esc(option.label)}</span></label>`).join('')}</div>`;
      if(field.kind==='select')return `<div class="form-field"><label for="action-${i}">${esc(field.label)}</label><select id="action-${i}" data-field="${esc(field.name)}" ${field.required?'required':''}>${field.options.map(o=>`<option value="${esc(o.value)}" ${o.value===field.value?'selected':''}>${esc(o.label)}</option>`).join('')}</select></div>`;
      if(field.kind==='textarea')return `<div class="form-field"><label for="action-${i}">${esc(field.label)}</label><textarea id="action-${i}" data-field="${esc(field.name)}" placeholder="${esc(field.placeholder||'')}" ${field.required?'required':''}>${esc(field.value||'')}</textarea></div>`;
      return `<div class="form-field"><label for="action-${i}">${esc(field.label)}</label><input id="action-${i}" data-field="${esc(field.name)}" type="${field.kind||'text'}" value="${esc(field.value||'')}" placeholder="${esc(field.placeholder||'')}" ${field.required?'required':''} ${i===0?'autofocus':''}></div>`;
    }).join('');
    $('#actionCancel').textContent=cancel;
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;dialog.close();form.onsubmit=null;$('#actionCancel').onclick=null;$('#actionClose').onclick=null;dialog.onclick=null;dialog.oncancel=null;resolve(value);};
      $('#actionCancel').onclick=()=>finish(null);$('#actionClose').onclick=()=>finish(null);dialog.onclick=e=>{if(e.target===dialog)finish(null);};dialog.oncancel=e=>{e.preventDefault();finish(null);};
      form.onsubmit=e=>{e.preventDefault();const result={};for(const field of fields){const matches=$$(`[data-field="${CSS.escape(field.name)}"]`,area);result[field.name]=field.kind==='checks'?matches.filter(x=>x.checked).map(x=>x.value):matches[0]?.value?.trim()||'';}finish(result);};
      dialog.showModal();area.querySelector('input,select,textarea')?.focus();
    });
  }
  function setPage(name) {
    if (!pageNames[name]) name = 'home';
    state.page = name; location.hash = name;
    $$('.nav-link[data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===name));
    $('#crumbCurrent').textContent = pageNames[name];
    renderPage(); $('#sidebar').classList.remove('open'); window.scrollTo({top:0,behavior:'smooth'});
  }
  function goTo(name) { state.collectionFilter=''; setPage(name); }
  function itemCard(item, i) {
    const subject = item.subject ? `<span class="item-subject">${esc(item.subject)}</span>` : '';
    return `<article class="item-card" style="--i:${i}" data-open="${esc(item.id)}"><div class="item-cover ${coverClass(item)}" aria-label="Cover for ${esc(item.title)}"><button class="favorite-toggle ${item.favorite?'on':''}" data-favorite="${esc(item.id)}" aria-label="${item.favorite?'Remove from':'Add to'} favorites">${item.favorite?'♥':'♡'}</button><span class="cover-play">▶</span></div><div class="item-info"><div class="item-title-row"><h3>${esc(item.title)}</h3><button class="item-menu-trigger" data-item-menu="${esc(item.id)}" aria-label="Manage ${esc(item.title)}">•••</button></div><div class="item-type">${niceType(item.type)} · ${item.files?.length > 1 ? 'Project' : 'HTML'}</div>${subject}</div><div class="item-menu" data-menu-for="${esc(item.id)}" hidden><button data-edit="${esc(item.id)}">Edit details</button><button data-rename="${esc(item.id)}">Rename project</button><button data-collect="${esc(item.id)}">Add to collection</button><button data-remove="${esc(item.id)}" class="danger">Remove from library</button></div></article>`;
  }
  function emptyState(title, description, button = 'Import something', page = 'import') {
    return `<div class="empty-state"><div><div class="empty-icon">✧</div><h3>${esc(title)}</h3><p>${esc(description)}</p><button class="button primary" data-go="${page}"><span class="plus">+</span>${esc(button)}</button></div></div>`;
  }
  function pageHeader(eyebrow,title,sub,action='') { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${sub}</p></div>${action}</div>`; }
  function renderHome() {
    const recent = [...state.items].sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0)).slice(0,4);
    const favorite = state.items.find(x=>x.favorite) || state.items[0];
    return `<div class="welcome-row"><div><div class="eyebrow">YOUR PERSONAL SPACE</div><h1>Good to have you here.</h1><p>Everything you learn, make and love — all in one place.</p></div><div class="welcome-actions"><button class="button" data-go="studio"><span>✦</span> AI studio</button><button class="button primary" data-import><span class="plus">+</span> Import</button></div></div>
      <section class="hero"><div class="hero-copy"><div class="hero-tag"><i></i> PRIVATE BY DESIGN</div><h2>${favorite ? `A little space for<br>${esc(favorite.title)}.` : 'Your world,<br>all in one place.'}</h2><p>${favorite ? `Pick up where you left off, or make room for something new.` : 'Bring together your learning, games, tools and ideas. Your library stays on this device, ready whenever you are.'}</p><button class="button primary" data-go="${favorite?'library':'import'}">${favorite?'Explore your library':'Bring something in'} <span>→</span></button></div><div class="hero-art" aria-hidden="true"><span class="hero-glint"></span><span class="hero-star">✦</span></div></section>
      <div class="section-row"><h2>Make yourself at home</h2><span class="eyebrow">A FEW WAYS TO BEGIN</span></div>
      <div class="quick-grid"><button class="quick-card" data-import><span class="quick-icon">⇧</span><span><b>Bring in a project</b><small>HTML files or a complete ZIP</small></span></button><button class="quick-card" data-go="learning"><span class="quick-icon">✳</span><span><b>Make a learning space</b><small>Keep your study material together</small></span></button><button class="quick-card" data-go="studio"><span class="quick-icon">✦</span><span><b>Prepare with AI studio</b><small>Get a ready-to-use project brief</small></span></button></div>
      <div class="section-row"><h2>Explore your space</h2></div><div class="collection-row"><a href="#library" data-go="library" class="collection-card"><span class="collection-icon">▦</span><span><b>Everything</b><small>${state.items.length} ${state.items.length===1?'item':'items'}</small></span></a><a href="#learning" data-go="learning" class="collection-card"><span class="collection-icon">✳</span><span><b>Learning</b><small>Notes & interactive lessons</small></span></a><a href="#games" data-go="games" class="collection-card"><span class="collection-icon">▷</span><span><b>Games & apps</b><small>Things to play and use</small></span></a><a href="#collections" data-go="collections" class="collection-card"><span class="collection-icon">▤</span><span><b>Collections</b><small>Your own little worlds</small></span></a></div>
      ${recent.length?`<div class="section-row"><h2>Recently opened</h2><a href="#recent" data-go="recent">See all →</a></div><div class="item-grid">${recent.map(itemCard).join('')}</div>`:''}<div class="welcome-note">Made for your things <span>·</span> Saved on this device <span>·</span> Yours to keep</div>`;
  }
  function renderLibrary(mode) {
    let list = [...state.items];
    if (mode==='favorites') list=list.filter(x=>x.favorite);
    if (mode==='recent') list=list.filter(x=>x.lastPlayed).sort((a,b)=>b.lastPlayed-a.lastPlayed);
    if (mode==='learning') list=list.filter(x=>x.type==='learning'||x.subject);
    if (mode==='games') list=list.filter(x=>['game','app','tool','simulation'].includes(x.type));
    if (mode==='library' && state.collectionFilter) list=list.filter(x=>(x.collections||[]).includes(state.collectionFilter));
    if (state.category!=='All items' && mode==='library') list=list.filter(x=>x.type===state.category.toLowerCase());
    if (state.query) { const q=state.query.toLowerCase(); list=list.filter(x=>[x.title,x.subject,x.description,x.type,...(x.tags||[])].join(' ').toLowerCase().includes(q)); }
    if (mode==='library' && state.sort==='name') list.sort((a,b)=>a.title.localeCompare(b.title));
    else if (mode==='library' && state.sort==='oldest') list.sort((a,b)=>a.created-b.created);
    else list.sort((a,b)=>b.created-a.created);
    const title = mode==='favorites'?'Your favorites':mode==='recent'?'Recently opened':mode==='learning'?'A place to learn':mode==='games'?'Games & apps':state.collectionFilter||'Everything, together';
    const sub = mode==='favorites'?'The things you want close at hand.':mode==='recent'?'Pick up where you left off.':mode==='learning'?'Your subjects, notes and interactive lessons.':mode==='games'?'Little escapes and useful things.':state.collectionFilter?`Everything you gathered in ${state.collectionFilter}.`:'A home for every HTML project you bring in.';
    const action='<button class="button primary" data-import><span class="plus">+</span> Import</button>';
    const filters = `<div class="toolbar"><label class="toolbar-search"><span>⌕</span><input type="search" data-library-search value="${esc(state.query)}" placeholder="Find something…" /></label>${mode==='library'?`<select class="select-control" data-sort><option value="recent" ${state.sort==='recent'?'selected':''}>Recently added</option><option value="name" ${state.sort==='name'?'selected':''}>Name A–Z</option><option value="oldest" ${state.sort==='oldest'?'selected':''}>Oldest first</option></select>`:''}<div class="view-toggle"><button class="${state.view==='grid'?'selected':''}" data-view="grid" aria-label="Grid view">▦</button><button class="${state.view==='list'?'selected':''}" data-view="list" aria-label="List view">☷</button></div></div>`;
    return `${pageHeader(mode==='learning'?'YOUR LEARNING SPACE':mode==='games'?'PLAY & EXPLORE':'YOUR LIBRARY',title,sub,action)}${filters}${list.length?`<div class="item-grid ${state.view==='list'?'compact':''}">${list.map(itemCard).join('')}</div>`:emptyState(state.query?'Nothing found':mode==='favorites'?'Nothing pinned just yet':mode==='recent'?'Your next adventure starts here':mode==='learning'?'A lovely place to begin':'Your library is ready for its first thing',state.query?'Try another title or subject.':mode==='favorites'?'Tap the heart on any item to keep it nearby.':mode==='recent'?'Open something from your library and it will be waiting here.':mode==='learning'?'Import an interactive lesson, study sheet or subject project.':'Add an HTML project or ZIP. It stays right here on your device.','Import HTML or ZIP')}`;
  }
  function renderCollections() {
    const subjects=['Mathematik','Physik','Informatik','Englisch','Kunst','Weitere Fächer'], custom=JSON.parse(localStorage.getItem('localdeck-collections')||'[]');
    return `${pageHeader('YOUR OWN LITTLE WORLDS','Collections','A gentle way to keep related things together.','<button class="button" data-new-collection>＋ New collection</button>')}<div class="collection-list">${['All items','Learning','Games & apps','Favorites'].map((x,i)=>`<a href="#${['library','learning','games','favorites'][i]}" class="collection-card" data-go="${['library','learning','games','favorites'][i]}"><span class="collection-icon">${['▦','✳','▷','♡'][i]}</span><span><b>${x}</b><small>${i===0?state.items.length:i===1?state.items.filter(x=>x.type==='learning'||x.subject).length:i===2?state.items.filter(x=>['game','app','tool','simulation'].includes(x.type)).length:state.items.filter(x=>x.favorite).length} items</small></span></a>`).join('')}${custom.map((x,i)=>`<button class="collection-card" data-collection="${esc(x)}"><span class="collection-icon">${['✧','◇','◈','✳'][i%4]}</span><span><b>${esc(x)}</b><small>${state.items.filter(y=>(y.collections||[]).includes(x)).length} items</small></span></button>`).join('')}</div><div class="section-row"><h2>Learning subjects</h2><button class="text-action" data-subject>Add a subject +</button></div><div class="subject-grid">${subjects.map((x,i)=>{const n=state.items.filter(y=>y.subject?.toLowerCase()===x.toLowerCase()).length;return `<button class="subject-card" data-subject-open="${esc(x)}"><span class="subject-icon">${['MAT','PHY','INF','ENG','ART','＋'][i]}</span><b>${x}</b><small>${n} ${n===1?'material':'materials'}</small></button>`}).join('')}</div>`;
  }
  function renderImport() { return `${pageHeader('BRING YOUR THINGS WITH YOU','A place for it all.','Your projects stay on this device. Nothing gets sent anywhere.')}<div class="dropzone" id="dropzone"><div><span class="drop-icon">⇧</span><h2>Bring a little something in</h2><p>Drop HTML files or a ZIP right here, or pick them from your device.</p><button class="button primary" data-import>Choose files</button><small>HTML pages and ZIP packages · Stored privately in this browser</small></div></div><div class="import-options"><div class="import-option"><span class="quick-icon">▤</span><h3>A whole project</h3><p>ZIP packages keep your HTML, images, sounds and other files together.</p></div><div class="import-option"><span class="quick-icon">◇</span><h3>A single page</h3><p>Bring in an HTML page. Add a few at once if you like.</p></div><div class="import-option"><span class="quick-icon">✳</span><h3>A study companion</h3><p>Give learning projects a subject so they find their way to your Learning hub.</p></div></div><div class="section-row"><h2>A note about offline</h2></div><div class="status-box"><strong>Designed to work offline.</strong> The launcher can be installed and keeps its shell available after first load. A project that depends on internet services or remote media may still need a connection. Your imports never leave this browser.</div>`; }
  function renderStudio() { return `${pageHeader('A LITTLE HELP FOR WHAT YOU’RE MAKING','Project companion','Create a clear hand-off for an AI coding tool. Your ideas stay on this device.')}<div class="studio-layout"><section class="surface-card"><h3>Tell us what you’re making</h3><p>We’ll shape a thoughtful project brief around it.</p><div class="form-field"><label for="studio-name">Project name</label><input id="studio-name" placeholder="e.g. Derivative practice" /></div><div class="form-field"><label for="studio-kind">What kind of thing?</label><select id="studio-kind"><option>Interactive learning material</option><option>Game</option><option>Application or tool</option><option>Simulation</option><option>Presentation</option></select></div><div class="form-field"><label for="studio-subject">Subject or category</label><input id="studio-subject" placeholder="e.g. Mathematics" /></div><div class="form-field"><label for="studio-details">What should it do?</label><textarea id="studio-details" placeholder="Describe the experience, audience and important features…"></textarea></div><button class="button primary" id="makePrompt">Create project brief <span>→</span></button></section><section class="surface-card"><h3>Your project brief</h3><p>Copy this into your favorite AI coding tool to get started.</p><div class="prompt-output" id="promptOutput">Your project brief will appear here.</div><button class="button" id="copyPrompt" style="margin-top:11px">Copy brief</button></section></div>`; }
  function renderSettings() { return `${pageHeader('MAKE YOUR SPACE FEEL LIKE YOURS','Settings','A few small choices for your LOCALDECK.')}<section class="surface-card"><h3>Look & feel</h3><p>Shape the way your library meets you.</p><div class="settings-row"><div><b>Use less motion</b><small>Reduce interface animation throughout LOCALDECK.</small></div><input class="switch" id="reduceMotion" type="checkbox" ${localStorage.getItem('localdeck-reduced-motion')==='true'?'checked':''}></div><div class="settings-row"><div><b>Ask before removing</b><small>Keep a confirmation step before deleting projects.</small></div><input class="switch" id="confirmDelete" type="checkbox" ${localStorage.getItem('localdeck-confirm-delete')!=='false'?'checked':''}></div><div class="settings-row"><div><b>Library backup</b><small>Make a portable ZIP of your projects and metadata.</small></div><button class="button" data-export>Export library</button></div><div class="settings-row"><div><b>Restore a library</b><small>Bring in a LOCALDECK backup ZIP you made earlier.</small></div><button class="button" data-restore>Restore backup</button></div></section><div class="section-row"><h2>Your privacy</h2></div><div class="status-box"><strong>Everything stays in your browser.</strong> Imports are stored in IndexedDB on this device. Clearing browser data may remove them, so an occasional backup is a good idea. LOCALDECK does not upload your projects.</div>`; }
  async function renderStorage() {
    const total=state.items.reduce((s,x)=>s+(x.size||0),0), usage=await navigator.storage?.estimate?.().catch(()=>null);
    return `${pageHeader('ON THIS DEVICE','Your library, kept close.','A little view of what LOCALDECK is keeping for you.','<button class="button primary" data-export>Make a backup</button>')}<div class="storage-details"><div class="metric"><span>Projects</span><b>${state.items.length}</b></div><div class="metric"><span>Project files</span><b>${bytes(total)}</b></div><div class="metric"><span>Browser storage available</span><b>${usage?.quota?bytes(Math.max(0,usage.quota-(usage.usage||0))):'—'}</b></div></div><div class="section-row"><h2>Library backup</h2></div><div class="surface-card"><h3>Take your library with you</h3><p>Export your projects into a single ZIP file, or restore a ZIP backup you made earlier.</p><div class="welcome-actions"><button class="button primary" data-export>Export library</button><button class="button" data-restore>Restore backup</button></div></div><div class="section-row"><h2>Your projects</h2></div>${state.items.length?`<div class="item-grid">${state.items.map(itemCard).join('')}</div>`:emptyState('Nothing stored just yet','As you bring in projects, you can keep an eye on them here.','Visit import center')}`;
  }
  async function renderPage() {
    const root=$('#pageContent');
    $('#crumbCurrent').textContent=pageNames[state.page]||'Home';
    if(state.page==='home') root.innerHTML=renderHome();
    else if(['library','favorites','recent','learning','games'].includes(state.page)) root.innerHTML=renderLibrary(state.page);
    else if(state.page==='collections') root.innerHTML=renderCollections();
    else if(state.page==='import') root.innerHTML=renderImport();
    else if(state.page==='studio') root.innerHTML=renderStudio();
    else if(state.page==='settings') root.innerHTML=renderSettings();
    else if(state.page==='storage') root.innerHTML=await renderStorage();
    else root.innerHTML=renderHome();
    updateStorage();
  }
  function updateStorage() {
    const n=state.items.reduce((s,x)=>s+(x.size||0),0); $('#navCount').textContent=state.items.length; $('#storageUsed').textContent=`${bytes(n)} used`;
    navigator.storage?.estimate?.().then(x=>{if(x.quota){$('#storageQuota').textContent=`${bytes(x.quota)} available`;$('#storageFill').style.width=`${Math.min(100,n/x.quota*100)}%`;}}).catch(()=>{$('#storageQuota').textContent='On this device';});
  }
  async function refresh() { state.items=await dbAll(); await renderPage(); }
  function routeURL(id, path) { return `${basePath}__localdeck_game/${encodeURIComponent(id)}/${path.split('/').map(encodeURIComponent).join('/')}`; }
  function findEntry(files) { return files.find(f=>/^index\.html?$/i.test(f.path.split('/').pop())) || files.find(f=>/\.html?$/i.test(f.path)) || files[0]; }
  function projectTitle(name) { return name.replace(/\.(html?|zip)$/i,'').replace(/[-_]+/g,' ').replace(/\b\w/g,x=>x.toUpperCase()); }
  async function importHTML(file) {
    const blob=new Blob([await file.arrayBuffer()],{type:'text/html'}), id=uid();
    const project={id,title:projectTitle(file.name),type:'other',description:'',subject:'',tags:[],created:Date.now(),favorite:false,lastPlayed:0,entry:file.name,files:[{path:file.name,blob}],size:file.size};
    return dbPut(project);
  }
  async function inflate(method, compressed) {
    if(method===0)return compressed;
    if(method!==8)throw new Error(`ZIP compression method ${method} is not supported.`);
    if(!('DecompressionStream' in window))throw new Error('This browser cannot open compressed ZIP files.');
    const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(file) {
    const data=new Uint8Array(await file.arrayBuffer()), view=new DataView(data.buffer,data.byteOffset,data.byteLength), decoder=new TextDecoder();
    let end=-1; for(let p=data.length-22;p>=Math.max(0,data.length-65558);p--){if(view.getUint32(p,true)===0x06054b50){end=p;break;}}
    if(end<0)throw new Error('This ZIP file looks incomplete.');
    const count=view.getUint16(end+10,true), cdSize=view.getUint32(end+12,true), cdOffset=view.getUint32(end+16,true); if(count>5000||cdSize>Math.max(data.length,1))throw new Error('This ZIP package is unusually large.');
    const files=[]; let p=cdOffset;
    for(let i=0;i<count;i++){
      if(view.getUint32(p,true)!==0x02014b50)throw new Error('Could not read this ZIP package.');
      const method=view.getUint16(p+10,true), csize=view.getUint32(p+20,true), nlen=view.getUint16(p+28,true), elen=view.getUint16(p+30,true), clen=view.getUint16(p+32,true), lhoff=view.getUint32(p+42,true);
      const name=decoder.decode(data.subarray(p+46,p+46+nlen)).replace(/\\/g,'/'); p+=46+nlen+elen+clen;
      if(name.endsWith('/')||name.startsWith('/')||name.split('/').includes('..'))continue;
      if(view.getUint32(lhoff,true)!==0x04034b50)throw new Error('A file inside this ZIP could not be read.');
      const localN=view.getUint16(lhoff+26,true),localE=view.getUint16(lhoff+28,true),start=lhoff+30+localN+localE;
      const content=await inflate(method,data.slice(start,start+csize));
      files.push({path:name,blob:new Blob([content],{type:mime(name)})});
    }
    return files;
  }
  function mime(path) { const ext=path.split('.').pop().toLowerCase(); return ({html:'text/html',htm:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',mp4:'video/mp4',webm:'video/webm',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',ico:'image/x-icon',wasm:'application/wasm',txt:'text/plain',xml:'application/xml'}[ext]||'application/octet-stream'); }
  async function importZIP(file) {
    const files=await unzip(file), entry=findEntry(files); if(!entry)throw new Error('No HTML page was found in this ZIP.');
    let meta={}; const metaFile=files.find(x=>x.path.toLowerCase().endsWith('localdeck.json'));
    if(metaFile)try{meta=JSON.parse(await metaFile.blob.text());}catch{}
    const total=files.reduce((s,x)=>s+x.blob.size,0);
    const project={id:uid(),title:meta.title||projectTitle(file.name),type:meta.type||'other',description:meta.description||'',subject:meta.subject||'',tags:meta.tags||[],created:Date.now(),favorite:false,lastPlayed:0,entry:entry.path,files,size:total};
    return dbPut(project);
  }
  async function handleFiles(fileList) {
    const files=[...fileList]; if(!files.length)return; toast(`Bringing in ${files.length===1?'your project':`${files.length} projects`}…`);
    let done=0;
    for(const file of files){try{if(file.name.toLowerCase().endsWith('.zip'))await importZIP(file);else if(file.name.match(/\.html?$/i)||file.type==='text/html')await importHTML(file);else throw new Error(`${file.name} is not an HTML or ZIP file.`);done++;}catch(e){toast(e.message,true);}}
    await refresh(); if(done){toast(`${done===1?'Your project is':'Your projects are'} here, saved on this device.`);setPage('library');}
  }
  async function playItem(id) {
    const item=state.items.find(x=>x.id===id); if(!item)return;
    if(!navigator.serviceWorker?.controller){toast('The local player is getting ready. Please try again in a moment.');return;}
    item.lastPlayed=Date.now(); await dbPut(item); state.currentPlayer=item;
    $('#playerName').textContent=item.title; $('#gameFrame').hidden=true; $('#playerLoading').hidden=false;
    $('#playerDialog').showModal(); const entry=routeURL(item.id,item.entry);
    $('#gameFrame').src=entry; setTimeout(()=>{if(state.currentPlayer?.id===id){$('#playerLoading').hidden=true;$('#gameFrame').hidden=false;}},500);
    $('#gameFrame').onload=()=>{if(state.currentPlayer?.id===id){$('#playerLoading').hidden=true;$('#gameFrame').hidden=false;}};
  }
  function closePlayer(){ $('#playerDialog').close(); $('#gameFrame').src='about:blank'; state.currentPlayer=null; refresh(); }
  async function toggleFavorite(id) {const item=state.items.find(x=>x.id===id);if(!item)return;item.favorite=!item.favorite;await dbPut(item);await refresh();}
  async function removeItem(id) {const item=state.items.find(x=>x.id===id);if(!item)return;if(localStorage.getItem('localdeck-confirm-delete')!=='false'){const ok=await actionDialog({title:'Remove this project?',description:`“${item.title}” will be removed from this browser. Export a backup first if you’d like to keep a copy.`,submit:'Remove project',danger:true});if(!ok)return;}await dbDelete(id);toast('Removed from your library.');await refresh();}
  async function renameItem(id) {const item=state.items.find(x=>x.id===id);if(!item)return;const result=await actionDialog({title:'Give it a new name',description:'Choose a name that feels right in your library.',fields:[{name:'title',label:'Project name',value:item.title,required:true}],submit:'Save name'});if(result?.title){item.title=result.title;await dbPut(item);toast('Project name updated.');await refresh();}}
  async function editItem(id) {const item=state.items.find(x=>x.id===id);if(!item)return;const types=['learning','game','app','simulation','presentation','tool','other'];const result=await actionDialog({title:'Edit project details',description:'A little context helps everything find its place.',fields:[{name:'type',label:'Kind of project',kind:'select',value:item.type||'other',options:types.map(x=>({value:x,label:niceType(x)}))},{name:'subject',label:'Subject or category',value:item.subject||'',placeholder:'e.g. Mathematics'}],submit:'Save details'});if(!result)return;item.type=result.type;item.subject=result.subject;await dbPut(item);toast('Project details updated.');await refresh();}
  async function collectItem(id) {const item=state.items.find(x=>x.id===id);if(!item)return;const collections=JSON.parse(localStorage.getItem('localdeck-collections')||'[]');if(!collections.length){toast('Create a collection first.');goTo('collections');return;}const result=await actionDialog({title:'Add to collections',description:'Keep this project close to the things it belongs with.',fields:[{name:'collections',kind:'checks',value:item.collections||[],options:collections.map(x=>({value:x,label:x}))}],submit:'Save collections'});if(!result)return;item.collections=result.collections;await dbPut(item);toast('Collections updated.');await refresh();}
  function generatePrompt() {
    const name=$('#studio-name').value.trim()||'Untitled project', kind=$('#studio-kind').value, subject=$('#studio-subject').value.trim()||'Not specified', details=$('#studio-details').value.trim()||'Create a clear, intuitive experience with thoughtful details.';
    const text=`Create a polished, responsive ${kind.toLowerCase()} called “${name}”.\n\nPURPOSE\n${details}\n\nORGANIZATION\nSubject or category: ${subject}\n\nLOCALDECK PACKAGE\n• Deliver a self-contained ZIP with a clear index.html entry point and all required assets kept in relative paths.\n• Add a valid localdeck.json with title, type, subject and a concise description.\n• Keep project content offline-friendly: avoid remote libraries, fonts, analytics and external media.\n• Preserve all existing behavior and make the interface work on desktop, tablet and phone.\n• Include a README with launch and control instructions.\n\nQUALITY\nUse accessible contrast, clear keyboard focus, touch-friendly controls, and restrained motion with reduced-motion support. Test that the project opens from its local index.html without a server.`;
    $('#promptOutput').textContent=text;
  }
  function crc32(data){let c=0xffffffff;for(let i=0;i<data.length;i++){c^=data[i];for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
  function makeZip(entries){const enc=new TextEncoder(),locals=[],central=[];let offset=0;const dt=new Date(),time=(dt.getHours()<<11)|(dt.getMinutes()<<5)|(dt.getSeconds()>>1),date=((dt.getFullYear()-1980)<<9)|((dt.getMonth()+1)<<5)|dt.getDate();
    for(const ent of entries){const name=enc.encode(ent.name),data=ent.data instanceof Uint8Array?ent.data:new Uint8Array(ent.data),crc=crc32(data),l=new Uint8Array(30+name.length),lv=new DataView(l.buffer);lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);l.set(name,30);locals.push(l,data);
      const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);c.set(name,46);central.push(c);offset+=l.length+data.length;
    }const cdSize=central.reduce((s,x)=>s+x.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,cdSize,true);v.setUint32(16,offset,true);return new Blob([...locals,...central,end],{type:'application/zip'});}
  async function exportLibrary(){if(!state.items.length){toast('Your library is empty for now.',true);return;}toast('Gathering your library…');const entries=[];for(const item of state.items){const prefix=`${item.id}/`;for(const f of item.files)entries.push({name:prefix+f.path,data:new Uint8Array(await f.blob.arrayBuffer())});const info={id:item.id,title:item.title,type:item.type,description:item.description,subject:item.subject,tags:item.tags,created:item.created,favorite:item.favorite,lastPlayed:item.lastPlayed,entry:item.entry,size:item.size,files:item.files.map(f=>f.path)};entries.push({name:`${prefix}localdeck-library-item.json`,data:new TextEncoder().encode(JSON.stringify(info,null,2))});}const blob=makeZip(entries),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`localdeck-backup-${new Date().toISOString().slice(0,10)}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);toast('Your backup is ready.');}
  async function restoreLibrary(file){try{const files=await unzip(file),groups=new Map();for(const f of files){const [folder,...rest]=f.path.split('/');if(!groups.has(folder))groups.set(folder,[]);groups.get(folder).push({...f,path:rest.join('/')});}let count=0;for(const [,arr] of groups){const meta=arr.find(f=>f.path==='localdeck-library-item.json');if(!meta)continue;const info=JSON.parse(await meta.blob.text()),projectFiles=arr.filter(f=>f.path&&f.path!=='localdeck-library-item.json');if(!projectFiles.length)continue;await dbPut({...info,files:projectFiles,size:projectFiles.reduce((s,x)=>s+x.blob.size,0)});count++;}await refresh();toast(`Restored ${count} ${count===1?'project':'projects'}.`);}catch(e){toast(`Couldn't restore that backup: ${e.message}`,true);}}
  function searchResults(q){const root=$('#searchResults');if(!q){root.innerHTML='';return;}const found=state.items.filter(x=>[x.title,x.subject,x.description,x.type,...(x.tags||[])].join(' ').toLowerCase().includes(q.toLowerCase())).slice(0,8);root.innerHTML=found.length?found.map(x=>`<button class="search-result" data-search-item="${esc(x.id)}"><span class="result-mark">${x.type==='learning'?'✳':x.type==='game'?'▷':'◇'}</span><span><b>${esc(x.title)}</b><small>${esc(x.subject||niceType(x.type))}</small></span></button>`).join(''):`<div class="search-empty">No matches this time.</div>`;}

  document.addEventListener('click',async e=>{
    const go=e.target.closest('[data-go]');if(go){e.preventDefault();goTo(go.dataset.go);return;}
    if(e.target.closest('[data-import]')){$('#fileInput').click();return;}
    const fav=e.target.closest('[data-favorite]');if(fav){e.stopPropagation();await toggleFavorite(fav.dataset.favorite);return;}
    const menu=e.target.closest('[data-item-menu]');if(menu){e.stopPropagation();const target=$(`[data-menu-for="${CSS.escape(menu.dataset.itemMenu)}"]`);const open=!target.hidden;$$('.item-menu').forEach(x=>x.hidden=true);target.hidden=open;return;}
    const rename=e.target.closest('[data-rename]');if(rename){e.stopPropagation();await renameItem(rename.dataset.rename);return;}
    const remove=e.target.closest('[data-remove]');if(remove){e.stopPropagation();await removeItem(remove.dataset.remove);return;}
    const edit=e.target.closest('[data-edit]');if(edit){e.stopPropagation();await editItem(edit.dataset.edit);return;}
    const collect=e.target.closest('[data-collect]');if(collect){e.stopPropagation();await collectItem(collect.dataset.collect);return;}
    const customCollection=e.target.closest('[data-collection]');if(customCollection){state.collectionFilter=customCollection.dataset.collection;setPage('library');return;}
    const card=e.target.closest('[data-open]');if(card){await playItem(card.dataset.open);return;}
    const result=e.target.closest('[data-search-item]');if(result){$('#searchDialog').close();await playItem(result.dataset.searchItem);return;}
    const view=e.target.closest('[data-view]');if(view){state.view=view.dataset.view;renderPage();return;}
    if(e.target.closest('[data-export]')){await exportLibrary();return;}
    if(e.target.closest('[data-restore]')){$('#backupInput').click();return;}
    if(e.target.closest('[data-subject]')){const result=await actionDialog({title:'Add a subject',description:'Create a subject for the learning projects you bring in.',fields:[{name:'name',label:'Subject name',placeholder:'e.g. Biology',required:true}],submit:'Add subject'});if(result?.name){const subjects=JSON.parse(localStorage.getItem('localdeck-subjects')||'[]');if(!subjects.includes(result.name))subjects.push(result.name);localStorage.setItem('localdeck-subjects',JSON.stringify(subjects));toast(`${result.name} is ready for your next learning project.`);await renderPage();}return;}
    const subj=e.target.closest('[data-subject-open]');if(subj){state.query=subj.dataset.subjectOpen;setPage('learning');return;}
    if(e.target.closest('[data-new-collection]')){const result=await actionDialog({title:'Create a collection',description:'Make a little space for projects that belong together.',fields:[{name:'name',label:'Collection name',placeholder:'e.g. Exam prep',required:true}],submit:'Create collection'});if(result?.name){const collections=JSON.parse(localStorage.getItem('localdeck-collections')||'[]');if(collections.includes(result.name)){toast('You already have a collection with that name.',true);}else{collections.push(result.name);localStorage.setItem('localdeck-collections',JSON.stringify(collections));toast('Your collection is ready. Add projects from their menu.');await renderPage();}}return;}
    if(e.target.id==='makePrompt'){generatePrompt();return;}
    if(e.target.id==='copyPrompt'){const t=$('#promptOutput').textContent;try{await navigator.clipboard.writeText(t);toast('Project brief copied.');}catch{toast('Select and copy your project brief.',true);}return;}
    if(e.target.id==='playerClose'||e.target.id==='playerExit'){closePlayer();return;}
    if(e.target.id==='playerReload'&&state.currentPlayer){const f=$('#gameFrame');f.src='about:blank';setTimeout(()=>f.src=routeURL(state.currentPlayer.id,state.currentPlayer.entry),50);return;}
    if(e.target.id==='playerFullscreen'){const f=$('#gameFrame');if(f.requestFullscreen)f.requestFullscreen();return;}
    if(e.target.id==='searchOpen'){ $('#searchDialog').showModal();$('#searchInput').focus();return;}
    if(e.target.id==='menuToggle'){$('#sidebar').classList.toggle('open');return;}
  });
  document.addEventListener('input',e=>{if(e.target.matches('[data-library-search]')){state.query=e.target.value;const pos=e.target.selectionStart;renderPage();const input=$('[data-library-search]');input?.focus();input?.setSelectionRange(pos,pos);}if(e.target.id==='searchInput')searchResults(e.target.value);});
  document.addEventListener('change',e=>{if(e.target.matches('[data-sort]')){state.sort=e.target.value;renderPage();}if(e.target.id==='fileInput')handleFiles(e.target.files);if(e.target.id==='backupInput'&&e.target.files[0])restoreLibrary(e.target.files[0]);if(e.target.id==='reduceMotion'){localStorage.setItem('localdeck-reduced-motion',e.target.checked);document.documentElement.classList.toggle('reduce-motion',e.target.checked);}if(e.target.id==='confirmDelete')localStorage.setItem('localdeck-confirm-delete',e.target.checked);});
  document.addEventListener('dragover',e=>{const d=e.target.closest('#dropzone');if(d){e.preventDefault();d.classList.add('dragging');}});
  document.addEventListener('dragleave',e=>{const d=e.target.closest('#dropzone');if(d&&!d.contains(e.relatedTarget))d.classList.remove('dragging');});
  document.addEventListener('drop',e=>{const d=e.target.closest('#dropzone');if(d){e.preventDefault();d.classList.remove('dragging');handleFiles(e.dataTransfer.files);}});
  document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='k'&&(e.metaKey||e.ctrlKey)){e.preventDefault();$('#searchDialog').showModal();$('#searchInput').focus();}if(e.key==='Escape'&&$('#playerDialog').open)closePlayer();});
  window.addEventListener('hashchange',()=>{const p=location.hash.slice(1);if(p&&p!==state.page&&pageNames[p]){state.page=p;$$('.nav-link[data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===p));$('#crumbCurrent').textContent=pageNames[p];renderPage();}});
  window.addEventListener('online',()=>{$('#onlineLabel').textContent=navigator.serviceWorker?.controller?'Offline-ready':'Setting up offline';$('#onlineDot').style.background='#4cab8f';});
  window.addEventListener('offline',()=>{$('#onlineLabel').textContent='Offline mode';$('#onlineDot').style.background='#c99a52';});
  if(localStorage.getItem('localdeck-reduced-motion')==='true')document.documentElement.classList.add('reduce-motion');
  async function init(){if(!('indexedDB'in window)){toast('This browser does not support local storage.',true);return;}try{await openDB();await refresh();if(location.hash&&pageNames[state.page]){$$('.nav-link[data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===state.page));$('#crumbCurrent').textContent=pageNames[state.page];}if('serviceWorker'in navigator&&location.protocol!=='file:'){navigator.serviceWorker.register(`${basePath}sw.js`,{scope:basePath}).then(()=>navigator.serviceWorker.ready).then(()=>{if(!navigator.serviceWorker.controller)location.reload();else $('#onlineLabel').textContent=navigator.onLine?'Offline-ready':'Offline mode';}).catch(()=>{$('#onlineLabel').textContent='Local library';});}else $('#onlineLabel').textContent='Local preview';navigator.storage?.persist?.().catch(()=>{});if(!navigator.onLine){$('#onlineLabel').textContent='Offline mode';$('#onlineDot').style.background='#c99a52';}}catch(e){toast(`Couldn't open your local library: ${e.message}`,true);}}
  init();
})();
