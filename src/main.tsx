Warning: truncated output (original token count: 19565)
Total output lines: 504

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'motion/react';
import {
  Activity, Archive, ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Clock3,
  Cloud, Copy, FileText, FolderPlus, Gamepad2, Heart, Home, Image, Info, Library, ListFilter,
  LoaderCircle, Menu, MoreHorizontal, PackageOpen, Play, Plus, Search, Settings, ShieldCheck,
  Share2, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import { openLibrary, db } from './services/database';
import { analyzeFiles } from './services/importer';
import { decryptSharePackage, encryptSharePackage } from './services/sharing';
import { exportItem, exportLibrary, restoreLibrary } from './services/backups';
import { createStoredZip } from './services/zip';
import {
  addToCollection, checkLibraryIntegrity, createCollection, createItem, deleteCollection, deleteItem, duplicateItem,
  finishOpenSession, getAllItems, getCollections,
  getSettings, getSubjects, recordOpenSession, removeFromCollection, repairLibrary, saveSubject, toggleFavorite,
  updateCollection, updateItem, type ItemSort,
} from './services/library';
import type { Collection, ContentType, ImportPreview, LibraryItem, Subject } from './types';
import './styles.css';

type Page = 'home' | 'library' | 'favorites' | 'recent' | 'learning' | 'games' | 'collections' | 'import' | 'studio' | 'storage' | 'sharing' | 'settings';
type AppRoute = { page: Page | 'shared'; shareId?: string; shareQuery?: string; collectionId?: string };
type ModalState = { kind: 'edit' | 'collect' | 'collection' | 'subject' | 'entry' | 'restore' | 'share'; item?: LibraryItem; preview?: ImportPreview; conflicts?: number; shareUrl?: string; shareArchive?: Blob };
const NAV: Array<{ page: Page; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }> = [
  { page: 'home', label: 'Home', icon: Home }, { page: 'library', label: 'All items', icon: Library },
  { page: 'favorites', label: 'Favorites', icon: Heart }, { page: 'recent', label: 'Recently opened', icon: Clock3 },
  { page: 'learning', label: 'Learning hub', icon: BookOpen }, { page: 'games', label: 'Games & apps', icon: Gamepad2 },
  { page: 'collections', label: 'Collections', icon: Archive }, { page: 'sharing', label: 'Shared links', icon: Cloud },
];
const TYPE_LABEL: Record<ContentType, string> = { game: 'Game', learning: 'Learning', app: 'App', tool: 'Tool', simulation: 'Simulation', presentation: 'Presentation', document: 'PDF', quiz: 'Quiz', other: 'Project' };
const TYPE_ICON: Record<ContentType, React.ComponentType<{ size?: number }>> = { game: Gamepad2, learning: BookOpen, app: Library, tool: Activity, simulation: Activity, presentation: Image, document: FileText, quiz: Check, other: PackageOpen };
const base = import.meta.env.BASE_URL;

function routeFromHash(): AppRoute {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  if (path.startsWith('shared/')) return { page: 'shared', shareId: path.slice(7), shareQuery: query };
  const valid = new Set<Page>(['home','library','favorites','recent','learning','games','collections','import','studio','storage','sharing','settings']);
  return { page: valid.has(path as Page) ? path as Page : 'home', ...(path === 'collections' && new URLSearchParams(query).has('collection') ? { collectionId: new URLSearchParams(query).get('collection') ?? undefined } : {}) };
}

function go(page: Page, suffix = '') { location.hash = `/${page}${suffix}`; }
function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
function friendlyDate(value?: number | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value) : 'Never opened';
}
function safeError(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
function formatRoutePath(id: string, path: string): string {
  return `${base}__localdeck_asset/${encodeURIComponent(id)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function App() {
  const reduceMotion = useReducedMotion();
  const [route, setRoute] = useState(routeFromHash);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ItemSort>('imported');
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [playing, setPlaying] = useState<LibraryItem | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [importPreviews, setImportPreviews] = useState<ImportPreview[]>([]);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [integrity, setIntegrity] = useState<{ orphanAssetCount: number; incompleteItemIds: string[] } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const refresh = useCallback(async () => {
    const [nextItems, nextCollections, nextSubjects] = await Promise.all([getAllItems(), getCollections(), getSubjects()]);
    setItems(nextItems); setCollections(nextCollections); setSubjects(nextSubjects);
  }, []);
  const closePlayer = useCallback(() => setPlaying(null), []);
  const playerOpened = useCallback(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let active = true;
    openLibrary().then(async () => {
      await refresh();
      const estimate = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      if (active) setStorage({ usage: estimate?.usage, quota: estimate?.quota, persisted });
      if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).then(() => {
          if (active) navigator.serviceWorker.ready.then(() => { if (active && !navigator.serviceWorker.controller) location.reload(); });
        }).catch(() => { if (active) notify('Offline caching could not start. Your library still works in this browser.', true); });
      }
      const motionSetting = await getSettings<boolean>('reduced-motion', false);
      if (active) setReducedMotion(motionSetting);
    }).catch(error => notify(`Could not open your local library: ${safeError(error)}`, true));
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
      if (event.key === 'Escape') { setSearchOpen(false); setMobileNav(false); }
    };
    window.addEventListener('keydown', onKey);
    const onStorage = async () => { const value = await navigator.storage?.estimate?.(); if (active) setStorage(old => ({ ...old, usage: value?.usage, quota: value?.quota })); };
    window.addEventListener('storage', onStorage);
    return () => { active = false; window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey); window.removeEventListener('storage', onStorage); };
  }, [notify, refresh]);

  useEffect(() => { if (route.page !== 'shared') void refresh(); }, [route.page, refresh]);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), 3600); return () => window.clearTimeout(id); }, [toast]);

  const currentPage = route.page === 'shared' ? 'shared' : route.page;
  const pageItems = useMemo(() => {
    let result = [...items];
    if (currentPage === 'favorites') result = result.filter(item => item.favorite);
    if (currentPage === 'learning') result = result.filter(item => ['learning','document','quiz'].includes(item.type));
    if (currentPage === 'games') result = result.filter(item => ['game','app','tool','simulation'].includes(item.type));
    if (currentPage === 'recent') result = result.filter(item => item.lastOpenedAt).sort((a,b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
    if (currentPage === 'collections' && route.collectionId) result = result.filter(item => item.collectionIds.includes(route.collectionId!));
    if (query.trim()) {
      const q = query.toLocaleLowerCase();
      result = result.filter(item => [item.title,item.description,item.type,item.subject,item.topic,item.genre,...item.tags].join(' ').toLocaleLowerCase().includes(q));
    }
    const comparator: Record<ItemSort,(a:LibraryItem,b:LibraryItem)=>number> = {
      name:(a,b)=>a.title.localeCompare(b.title), imported:(a,b)=>b.importedAt-a.importedAt,
      opened:(a,b)=>(b.lastOpenedAt??0)-(a.lastOpenedAt??0), size:(a,b)=>b.storageSize-a.storageSize, modified:(a,b)=>b.updatedAt-a.updatedAt,
    };
    if (currentPage !== 'recent') result.sort(comparator[sort]);
    return result;
  }, [items, currentPage, query, route.collectionId, sort]);

  const pageTitle = currentPage === 'collections' && route.collectionId ? collections.find(x => x.id === route.collectionId)?.name ?? 'Collection' : ({ home:'Home', library:'All items', favorites:'Favorites', recent:'Recently opened', learning:'Learning hub', games:'Games & apps', collections:'Collections', import:'Import center', studio:'AI studio', storage:'Storage & backups', sharing:'Shared links', settings:'Settings', shared:'Shared project' } as Record<string,string>)[currentPage];

  const openProject = (item: LibraryItem) => setPlaying(item);

  const handlePickedFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { const previews = await analyzeFiles(files); setImportPreviews(previews); await refresh(); notify(`${previews.length} import preview${previews.length === 1 ? '' : 's'} ready. Nothing is saved until you confirm.`); if (route.page !== 'import') go('import'); }
    catch (error) { notify(safeError(error), true); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; if (folderInput.current) folderInput.current.value = ''; }
  };

  const savePreview = async (preview: ImportPreview) => {
    try { setBusy(true); await createItem(preview); setImportPreviews(list => list.filter(x => x !== preview)); await refresh(); notify(`“${preview.title}” is saved on this device.`); }
    catch (error) { notify(safeError(error), true); }
    finally { setBusy(false); }
  };

  const deleteProject = async (item: LibraryItem) => {
    if (!window.confirm(`Remove “${item.title}” and its ${item.fileCount} stored file${item.fileCount === 1 ? '' : 's'} from this browser?`)) return;
    try { await deleteItem(item.id); await refresh(); notify('Project removed from this browser.'); }
    catch (error) { notify(safeError(error), true); }
  };

  const performBackup = async () => {
    try { setBusy(true); const blob = await exportLibrary(); downloadBlob(blob, `localdeck-backup-${new Date().toISOString().slice(0,10)}.zip`); notify(`Backup ready · ${bytes(blob.size)}`); }
    catch (error) { notify(`Backup could not be created: ${safeError(error)}`, true); }
    finally { setBusy(false); }
  };

  const prepareShare = async (item: LibraryItem) => {
    setBusy(true);
    try { const shareArchive = await exportItem(item.id); setModal({ kind:'share', item, shareArchive }); }
    catch (error) { notify(`Share package could not be prepared: ${safeError(error)}`, true); }
    finally { setBusy(false); }
  };

  const createEncryptedShare = async (archive: Blob, apiValue: string, token: string) => {
    if (!apiValue.trim() || !token.trim()) throw new Error('Enter the Worker URL and owner token first.');
    const { payload, fragmentKey } = await encryptSharePackage(archive);
    const apiBase = apiValue.trim().replace(/\/$/, '');
    const response = await fetch(`${apiBase}/api/v1/shares`, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'content-type':'application/octet-stream' }, body:payload });
    if (!response.ok) throw new Error(response.status === 401 ? 'The owner token was not accepted.' : `Share upload failed (${response.status}).`);
    const data = await response.json() as { id:string; expiresAt:string };
    const url = new URL(location.href); url.hash = `/shared/${encodeURIComponent(data.id)}?k=${fragmentKey}`;
    return { url:url.toString(), expiresAt:data.expiresAt };
  };

  const handleRestore = async (file?: File) => {
    if (!file) return;
    try {
      setBusy(true);
      // Restore service validates the entire archive before its transaction; keep-both resolves ID conflicts.
      const result = await restoreLibrary(file, 'keep-both');
      await refresh(); notify(`Restored ${result.restored} project${result.restored === 1 ? '' : 's'}${result.remapped ? ` · ${result.remapped} ID conflict${result.remapped === 1 ? '' : 's'} remapped` : ''}.`);
    } catch (error) { notify(`Backup was not restored: ${safeError(error)}`, true); }
    finally { setBusy(false); if (restoreInput.current) restoreInput.current.value = ''; }
  };

  const saveModal = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setDialogError(''); const form = new FormData(event.currentTarget);
    try {
      if (modal?.kind === 'edit' && modal.item) {
        await updateItem(modal.item.id, { title: String(form.get('title')).trim(), type: String(form.get('type')) as ContentType, subject: String(form.get('subject')).trim(), topic: String(form.get('topic')).trim(), description: String(form.get('description')).trim(), tags: String(form.get('tags')).split(',').map(x => x.trim()).filter(Boolean) });
        await refresh(); notify('Project details updated.');
      } else if (modal?.kind === 'collect' && modal.item) {
        const selected = new Set(form.getAll('collectionIds').map(String));
        const current = new Set(modal.item.collectionIds);
        for (const collection of collections) {
          if (selected.has(collection.id) && !current.has(collection.id)) await addToCollection(modal.item.id, collection.id);
          if (!selected.has(collection.id) && current.has(collection.id)) await removeFromCollection(modal.item.id, collection.id);
        }
        await refresh(); notify('Collection membership updated.');
      } else if (modal?.kind === 'collection') {
        const created = await createCollection(String(form.get('name')), String(form.get('description')));
        await refresh(); notify(`Collection “${created.name}” created.`);
      } else if (modal?.kind === 'subject') {
        const saved = await saveSubject({ name: String(form.get('name')), description: String(form.get('description')) });
        await refresh(); notify(`Subject “${saved.name}” saved.`);
      } else if (modal?.kind === 'restore') {
        await handleRestore(form.get('backup') instanceof File ? form.get('backup') as File : undefined);
      } else if (modal?.kind === 'share' && modal.item) {
        setBusy(true);
        try {
          if (!modal.shareArchive) throw new Error('The local share package is no longer available. Close this dialog and prepare the link again.');
          const result = await createEncryptedShare(modal.shareArchive, String(form.get('api')), String(form.get('token')));
          setModal({ ...modal, shareUrl:result.url });
          notify('Encrypted share link created. Anyone with the full link can open this project until it expires.');
        } finally { setBusy(false); }
        return;
      } else if (modal?.kind === 'entry' && modal.preview) {
        setImportPreviews(list => list.map(preview => preview.id === modal.preview!.id ? modal.preview! : preview));
        notify('Import details updated.');
      }
      setModal(null);
    } catch (error) { setDialogError(safeError(error)); }
  };

  const requestPersistentStorage = async () => {
    if (!navigator.storage?.persist) { notify('This browser does not support persistent storage requests.', true); return; }
    const persisted = await navigator.storage.persist(); setStorage(value => ({ ...value, persisted }));
    notify(persisted ? 'The browser marked LOCALDECK storage as persistent.' : 'The browser declined persistent storage. Export backups regularly.', !persisted);
  };

  const checkIntegrity = async () => { try { setIntegrity(await checkLibraryIntegrity()); notify('Storage integrity check complete.'); } catch (error) { notify(safeError(error), true); } };
  const runRepair = async () => { if (!window.confirm('Repair removes orphaned files and incomplete project entries. Incomplete projects can no longer be opened. Export a backup first if you are unsure.')) return; try { const result = await repairLibrary(); await refresh(); setIntegrity(await checkLibraryIntegrity()); notify(`Repair complete · ${result.removedAssets} orphaned files, ${result.removedItems} incomplete projects removed.`); } catch (error) { notify(safeError(error), true); } };

  const routeMotion = reduceMotion || reducedMotion ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 1 } } : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: .2, ease: 'easeOut' as const } };

  return <MotionConfig reducedMotion={reduceMotion || reducedMotion ? 'always' : 'never'}><div className="app-shell">
    <input ref={fileInput} className="visually-hidden" type="file" accept=".html,.htm,.zip,.pdf,text/html,application/pdf,application/zip" multiple onChange={event => void handlePickedFiles(event.target.files)} />
    <input ref={folderInput} className="visually-hidden" type="file" {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>} multiple onChange={event => void handlePickedFiles(event.target.files)} />
    <input ref={restoreInput} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={event => void handleRestore(event.target.files?.[0])} />
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#/home" aria-label="LOCALDECK home"><span className="brand-mark"><img src={`${base}icon-192.png`} alt="" /></span><span>localdeck</span></a>
      <div className="workspace-card"><span className="workspace-icon">L</span><span><b>My library</b><small>Private space</small></span><ChevronDown size={15} /></div>
      <div className="nav-heading">Library</div>
      <nav className="nav-list" aria-label="Library navigation">{NAV.slice(0,4).map(({ page,label,icon:Icon }) => <NavItem key={page} page={page} active={currentPage === page} label={label} icon={Icon} count={page === 'library' ? items.length : undefined} onNavigate={() => setMobileNav(false)} />)}</nav>
      <div className="nav-heading">Explore</div>
      <nav className="nav-list" aria-label="Explore navigation">{NAV.slice(4).map(({ page,label,icon:Icon }) => <NavItem key={page} page={page} active={currentPage === page} label={label} icon={Icon} onNavigate={() => setMobileNav(false)} />)}</nav>
      <div className="nav-heading nav-heading-spaced">Make it yours</div>
      <nav className="nav-list" aria-label="Tools navigation">
        <NavItem page="import" active={currentPage === 'import'} label="Import center" icon={Upload} onNavigate={() => setMobileNav(false)} />
        <NavItem page="studio" active={currentPage === 'studio'} label="AI studio" icon={Sparkles} onNavigate={() => setMobileNav(false)} />
        <NavItem page="storage" active={currentPage === 'storage'} label="Storage & backups" icon={Archive} onNavigate={() => setMobileNav(false)} />
        <NavItem page="sharing" active={currentPage === 'sharing'} label="Shared links" icon={Cloud} onNavigate={() => setMobileNav(false)} />
      </nav>
      <div className="sidebar-spacer" />
      <StorageMini storage={storage} items={items} />
      <NavItem page="settings" active={currentPage === 'settings'} label="Settings" icon={Settings} onNavigate={() => setMobileNav(false)} />
      <div className="profile-row"><span className="profile-avatar">Y</span><span><b>Your space</b><small>Saved on this device</small></span><ShieldCheck size={16} /></div>
    </aside>
    {mobileNav && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label="Open menu" onClick={() => setMobileNav(true)}><Menu size={19} /></button>
        <div className="breadcrumbs"><span>My library</span><span className="crumb-separator">/</span><b>{pageTitle}</b></div>
        <div className="top-actions"><span className={`offline-pill ${navigator.onLine ? '' : 'offline'}`}><i />{navigator.onLine ? 'Offline-ready' : 'Offline mode'}</span><button className="search-trigger" onClick={() => setSearchOpen(true)}><Search size={16} /><span>{query || 'Search anything'}</span><kbd>⌘ K</kbd></button><button className="avatar-small" aria-label="User profile">Y</button></div>
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${currentPage}-${route.shareId ?? ''}`} className="page-content" {...routeMotion}>
          {currentPage === 'home' && <HomePage items={items} open={openProject} add={() => fileInput.current?.click()} navigate={go} favorite={async item=>{try{await toggleFavorite(item.id);await refresh();}catch(error){notify(safeError(error),true);}}} />}
          {['library','favorites','recent','learning','games'].includes(currentPage) && <LibraryPage page={currentPage as Page} items={pageItems} query={query} setQuery={setQuery} sort={sort} setSort={setSort} open={openProject} edit={item => setModal({ kind:'edit',item })} collect={item=>setModal({kind:'collect',item})} share={prepareShare} remove={deleteProject} favorite={async item => { try { await toggleFavorite(item.id); await refresh(); } catch (error) { notify(safeError(error), true); } }} exportOne={async item => { try { const blob = await exportItem(item.id); downloadBlob(blob, `${item.title.replace(/[^a-z0-9_-]+/gi,'-')}.zip`); notify(`Project archive ready · ${bytes(blob.size)}`); } catch (error) { notify(safeError(error), true); } }} duplicate={async item => { try { await duplicateItem(item.id); await refresh(); notify('Project duplicated.'); } catch (error) { notify(safeError(error), true); } }} />}
          {currentPage === 'collections' && (route.collectionId ? <CollectionDetail collection={collections.find(x=>x.id===route.collectionId)} items={pageItems} onBack={()=>go('collections')} open={openProject} favorite={async item=>{try{await toggleFavorite(item.id);await refresh();}catch(error){notify(safeError(error),true);}}} onChange={async (collectionId,ordered)=>{await updateCollection(collectionId,{orderedItemIds:ordered});await refresh();}} onRemove={async item=>{if(!route.collectionId)return;await removeFromCollection(item.id,route.collectionId);await refresh();…7565 tokens truncated…ects from a LOCALDECK backup. Matching project IDs are kept as separate copies.</p><button className="button" disabled={busy} onClick={restore}>Choose a backup ZIP</button></div><div className="panel"><span className="panel-icon mint"><ShieldCheck size={18}/></span><h2>Check library integrity</h2><p>Find project records with missing files and assets left behind by interrupted operations.</p><div className="row-actions"><button className="button" onClick={checkIntegrity}>Run check</button>{integrity&&(integrity.orphanAssetCount||integrity.incompleteItemIds.length)?<button className="button danger-button" onClick={repair}>Repair storage</button>:null}</div>{integrity&&<small className={integrity.orphanAssetCount||integrity.incompleteItemIds.length?'warning-text':'success-text'}>{integrity.orphanAssetCount} orphaned files · {integrity.incompleteItemIds.length} incomplete projects</small>}</div></div>
    {byType.length>0&&<section className="section-block"><div className="section-title-row"><div><h2>Space by project type</h2><p>Calculated from files stored in your library</p></div></div><div className="usage-list">{byType.map(([type,size])=><div className="usage-row" key={type}><span>{TYPE_LABEL[type as ContentType]??type}</span><div><i style={{width:`${Math.max(1,Math.round(size/Math.max(projectBytes,1)*100))}%`}}/></div><b>{bytes(size)}</b></div>)}</div></section>}
    {items.length>0&&<section className="section-block"><div className="section-title-row"><div><h2>Largest projects</h2><p>Useful when your browser storage is getting full</p></div></div><div className="largest-list">{[...items].sort((a,b)=>b.storageSize-a.storageSize).slice(0,5).map(item=><div key={item.id}><span><b>{item.title}</b><small>{item.fileCount} file{item.fileCount===1?'':'s'} · {TYPE_LABEL[item.type]}</small></span><strong>{bytes(item.storageSize)}</strong></div>)}</div></section>}
  </>;
}

function SettingsPage({reducedMotion,onMotion}:{reducedMotion:boolean;onMotion:(value:boolean)=>void}) {
  return <><PageHeading eyebrow="Preferences" title="Settings" description="Tune the way LOCALDECK behaves in this browser."/><div className="settings-list"><label className="setting-row"><span><b>Reduce motion</b><small>Use simple fades instead of movement when the system preference is not enough.</small></span><input type="checkbox" checked={reducedMotion} onChange={event=>onMotion(event.target.checked)}/></label><div className="setting-row"><span><b>Project isolation</b><small>Imported HTML opens in an opaque sandbox. Its scripts cannot read LOCALDECK's IndexedDB or page.</small></span><ShieldCheck size={18} className="settings-secure"/></div><div className="setting-row"><span><b>Optional encrypted sharing</b><small>Connect a Cloudflare Worker from Shared links. The app asks for your owner token only when needed and never saves it.</small></span><Cloud size={18} className="settings-secure"/></div></div></>;
}

type ShareRecord = { id:string; status:string; createdAt:string; expiresAt:string; sizeBytes:number; label:string };
function SharingPage({notify}:{notify:(message:string,error?:boolean)=>void}) {
  const [api,setApi]=useState(import.meta.env.VITE_SHARE_API_BASE??'');
  const [token,setToken]=useState('');
  const [shares,setShares]=useState<ShareRecord[]>([]);
  const [loading,setLoading]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const load=async()=>{
    if(!api.trim()||!token.trim()){notify('Enter the Worker URL and owner token.',true);return;}
    setLoading(true);
    try{const response=await fetch(`${api.trim().replace(/\/$/,'')}/api/v1/shares/owner/shares`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error(response.status===401?'The owner token was not accepted.':`Could not load shared links (${response.status}).`);setShares(await response.json() as ShareRecord[]);setLoaded(true);}
    catch(error){notify(safeError(error),true);}
    finally{setLoading(false);}
  };
  const revoke=async(id:string)=>{
    if(!window.confirm('Revoke this link now? Anyone using it will lose access.'))return;
    try{const response=await fetch(`${api.trim().replace(/\/$/,'')}/api/v1/shares/${encodeURIComponent(id)}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error(`Could not revoke this link (${response.status}).`);setShares(list=>list.map(share=>share.id===id?{...share,status:'revoked'}:share));notify('Share link revoked.');}
    catch(error){notify(safeError(error),true);}
  };
  return <><PageHeading eyebrow="Optional Cloudflare service" title="Shared links" description="Create encrypted links from any project menu, then review or revoke them here."/><section className="share-manager panel"><div className="share-manager-heading"><span className="share-manager-icon"><Cloud size={19}/></span><div><h2>Manage your share links</h2><p>Your owner token stays in this page's memory and clears when you leave.</p></div></div><div className="share-manager-fields"><label className="form-field"><span>Worker URL</span><input type="url" value={api} onChange={event=>setApi(event.target.value)} placeholder="https://your-worker.workers.dev"/></label><label className="form-field"><span>Owner token</span><input type="password" value={token} onChange={event=>setToken(event.target.value)} autoComplete="off" placeholder="Enter your private token"/></label><button className="button primary" disabled={loading} onClick={()=>void load()}>{loading?<LoaderCircle size={15} className="spin"/>:<Activity size={15}/>} {loaded?'Refresh links':'Load links'}</button></div>{loaded&&(shares.length?<div className="share-list">{shares.map(share=><div className="share-row" key={share.id}><span className={`share-state ${share.status==='active'&&Date.parse(share.expiresAt)>Date.now()?'active':'inactive'}`} /><span className="share-row-main"><b>{share.label}</b><small>{share.status==='revoked'?'Revoked':Date.parse(share.expiresAt)<=Date.now()?'Expired':`Expires ${friendlyDate(Date.parse(share.expiresAt))}`} · {bytes(share.sizeBytes)}</small></span>{share.status==='active'&&Date.parse(share.expiresAt)>Date.now()&&<button className="button danger-button" onClick={()=>void revoke(share.id)}><Trash2 size={14}/> Revoke</button>}</div>)}</div>:<EmptyState icon={Share2} title="No share links yet" detail="Create an encrypted link from a project's actions menu."/>)}{!import.meta.env.VITE_SHARE_API_BASE&&<p className="share-setup-hint"><Info size={14}/> Sharing stays optional. Set <code>VITE_SHARE_API_BASE</code> to your Worker URL to make this available to everyone.</p>}</section></>;
}

function Player({item,close,onOpened}:{item:LibraryItem;close:()=>void;onOpened:()=>void}) {
  const sessionStart=useRef(Date.now()); const sessionId=useRef(''); const frame=useRef<HTMLIFrameElement>(null);
  const entryUrl=formatRoutePath(item.id,item.entryFile);
  useEffect(()=>{let active=true;recordOpenSession(item.id).then(row=>{if(active){sessionId.current=row.id;onOpened();}});const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};window.addEventListener('keydown',onKey);return()=>{active=false;window.removeEventListener('keydown',onKey);if(sessionId.current)void finishOpenSession(sessionId.current,Date.now()-sessionStart.current);};},[item.id,close,onOpened]);
  const fullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await frame.current?.requestFullscreen();}catch{}}
  return <div className="player-overlay" role="dialog" aria-modal="true" aria-label={`${item.title} player`}><header className="player-top"><div className="player-name"><button className="icon-button" onClick={close} aria-label="Back to library"><ArrowLeft size={19}/></button><span className="player-live-dot"/><b>{item.title}</b><small>LOCAL PROJECT</small></div><div className="player-controls"><button className="button" onClick={()=>{if(frame.current)frame.current.src=entryUrl;}} title="Restart project">Restart</button><button className="icon-button" onClick={()=>void fullscreen()} title="Fullscreen" aria-label="Fullscreen"><span className="fullscreen-glyph">⛶</span></button><button className="button primary" onClick={close}>Done</button></div></header><div className={`player-stage ${item.type==='document'?'document-stage':''}`}><iframe key={`${item.id}-${entryUrl}`} ref={frame} title={item.title} src={entryUrl} sandbox={item.type==='document'?'allow-downloads':'allow-scripts allow-forms allow-pointer-lock allow-presentation allow-downloads'} allow="fullscreen; autoplay; gamepad" referrerPolicy="no-referrer" /></div><footer className="player-footer"><span><ShieldCheck size={14}/> Runs in an isolated browser frame</span><span>{item.offlineCompatibility.score==='likely'?'Offline-compatible signals found':'Some features may need the internet or a different browser'}</span></footer></div>;
}

function SearchOverlay({open,onClose,value,onChange,items,onOpen}:{open:boolean;onClose:()=>void;value:string;onChange:(value:string)=>void;items:LibraryItem[];onOpen:(item:LibraryItem)=>void}) {
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(open)input.current?.focus();},[open]);
  const results=value.trim()?items.filter(item=>[item.title,item.subject,item.topic,item.description,...item.tags].join(' ').toLocaleLowerCase().includes(value.toLocaleLowerCase())).slice(0,8):[];
  return <AnimatePresence>{open&&<motion.div className="search-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><motion.div className="search-panel" initial={{opacity:0,y:-10,scale:.99}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-6}} transition={{duration:.16}}><div className="search-panel-input"><Search size={19}/><input ref={input} value={value} onChange={event=>onChange(event.target.value)} placeholder="Search your library…"/><kbd>ESC</kbd><button className="icon-button" onClick={onClose} aria-label="Close search"><X size={18}/></button></div>{value.trim()&&<div className="search-panel-results">{results.length?results.map(item=><button key={item.id} onClick={()=>onOpen(item)}><span className="search-result-icon"><PreviewIcon type={item.type}/></span><span><b>{item.title}</b><small>{item.subject||TYPE_LABEL[item.type]}</small></span><ArrowRight size={15}/></button>):<p>No matches found. Try another title, subject, or tag.</p>}</div>}<div className="search-footer">Search titles, subjects, topics, descriptions, and tags</div></motion.div></motion.div>}</AnimatePresence>;
}

function Modal({modal,collections,busy,onClose,onSubmit,error,onPreviewChange}:{modal:ModalState;collections:Collection[];busy:boolean;onClose:()=>void;onSubmit:(event:React.FormEvent<HTMLFormElement>)=>void;error:string;onPreviewChange:(update:Partial<ImportPreview>)=>void}) {
  const dialogRef=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=dialogRef.current;if(!dialog)return;dialog.showModal();return()=>{if(dialog.open)dialog.close();};},[]);
  const title=modal.kind==='edit'?'Edit project details':modal.kind==='collect'?'Add to collections':modal.kind==='collection'?'New collection':modal.kind==='subject'?'Add a subject':modal.kind==='restore'?'Restore a backup':modal.kind==='share'?'Create a private link':'Import details';
  return <motion.div className="modal-scrim" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><motion.dialog ref={dialogRef} className="form-dialog" onCancel={event=>{event.preventDefault();onClose();}} initial={{opacity:0,y:10,scale:.985}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:8,scale:.99}} transition={{duration:.18}}><form onSubmit={onSubmit}><button type="button" className="dialog-close icon-button" aria-label="Close" onClick={onClose}><X size={18}/></button><div className="eyebrow">LOCALDECK</div><h2>{title}</h2><p className="dialog-description">{modal.kind==='edit'?'Adjust the details used to organize and search this project.':modal.kind==='collection'?'Create a space for a class, topic, or group of projects.':modal.kind==='subject'?'Add a subject that you can use across your learning materials.':modal.kind==='restore'?'Choose a LOCALDECK ZIP backup. Existing project IDs will be kept as separate copies.':`Check the entry page and details for ${modal.preview?.sourceName ?? 'this project'}.`}</p>
      {modal.kind==='edit'&&modal.item&&<><label className="form-field"><span>Name</span><input name="title" defaultValue={modal.item.title} required maxLength={120}/></label><label className="form-field"><span>Type</span><select name="type" defaultValue={modal.item.type}>{Object.entries(TYPE_LABEL).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="form-field"><span>Subject or category</span><input name="subject" defaultValue={modal.item.subject}/></label><label className="form-field"><span>Topic</span><input name="topic" defaultValue={modal.item.topic}/></label><label className="form-field"><span>Description</span><textarea name="description" rows={3} defaultValue={modal.item.description}/></label><label className="form-field"><span>Tags, separated by commas</span><input name="tags" defaultValue={modal.item.tags.join(', ')}/></label></>}
      {modal.kind==='collect'&&modal.item&&<>{collections.length? <div className="collection-checks">{collections.map(collection=><label key={collection.id}><input type="checkbox" name="collectionIds" value={collection.id} defaultChecked={modal.item!.collectionIds.includes(collection.id)}/><span><b>{collection.name}</b><small>{collection.description||'Collection'}</small></span></label>)}</div>:<div className="empty-collections"><p>You do not have a collection yet. Create one to group this project with others.</p><button type="button" className="button" onClick={()=>{onClose();go('collections');}}>Go to collections</button></div>}</>}
      {modal.kind==='collection'&&<><label className="form-field"><span>Name</span><input name="name" placeholder="e.g. Biology exam prep" required maxLength={80}/></label><label className="form-field"><span>Description</span><input name="description" placeholder="Optional" maxLength={160}/></label></>}
      {modal.kind==='subject'&&<><label className="form-field"><span>Subject name</span><input name="name" placeholder="e.g. Biology" required maxLength={80}/></label><label className="form-field"><span>Description</span><input name="description" placeholder="Optional"/></label></>}
      {modal.kind==='restore'&&<label className="form-field"><span>Backup ZIP</span><input name="backup" type="file" accept=".zip,application/zip" required/></label>}
      {modal.kind==='share'&&!modal.shareUrl&&<><div className="privacy-note"><ShieldCheck size={17}/><span><b>Encrypted before upload</b><small>The project ZIP is encrypted in your browser. The link key stays in the URL fragment and is never sent to the sharing server. Recipients can keep a copy after downloading.</small></span></div><div className="share-item-summary"><span className="preview-icon"><PreviewIcon type={modal.item!.type}/></span><span><b>{modal.item!.title}</b><small>{TYPE_LABEL[modal.item!.type]} · ZIP package {bytes(modal.shareArchive?.size ?? 0)} · 24 MiB upload limit</small></span></div>{(modal.shareArchive?.size ?? 0)>24*1024*1024&&<p className="warning-text">This ZIP is too large for free encrypted sharing. Export the project and reduce its size before trying again.</p>}<label className="form-field"><span>Cloudflare Worker URL</span><input name="api" defaultValue={import.meta.env.VITE_SHARE_API_BASE??''} placeholder="https://your-worker.workers.dev" required type="url"/></label><label className="form-field"><span>Owner token</span><input name="token" type="password" autoComplete="off" required/></label><p className="share-setup-hint">Links expire automatically after 3 days. Free storage is capped at 512 MiB with up to 3 uploads in progress.</p></>}
      {modal.kind==='share'&&modal.shareUrl&&<div className="share-created"><span className="share-created-icon"><Check size={20}/></span><h3>Your encrypted link is ready</h3><p>Anyone with this complete link can import <b>{modal.item?.title}</b> until it expires. Keep the link somewhere private.</p><div className="share-link-field"><input readOnly value={modal.shareUrl} aria-label="Encrypted share link"/><button type="button" className="button primary" onClick={()=>void navigator.clipboard.writeText(modal.shareUrl!).catch(()=>{})}><Copy size={15}/> Copy</button></div></div>}
      {modal.kind==='entry'&&modal.preview&&<><label className="form-field"><span>Project name</span><input value={modal.preview.title} onChange={event=>onPreviewChange({title:event.target.value})} required maxLength={120}/></label><label className="form-field"><span>Type</span><select value={modal.preview.type} onChange={event=>onPreviewChange({type:event.target.value as ContentType})}>{Object.entries(TYPE_LABEL).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="form-field"><span>Subject or category</span><input value={modal.preview.subject} onChange={event=>onPreviewChange({subject:event.target.value})}/></label><label className="form-field"><span>Topic</span><input value={modal.preview.topic} onChange={event=>onPreviewChange({topic:event.target.value})}/></label><label className="form-field"><span>Description</span><textarea rows={3} value={modal.preview.description} onChange={event=>onPreviewChange({description:event.target.value})}/></label><label className="form-field"><span>Tags, separated by commas</span><input value={modal.preview.tags.join(', ')} onChange={event=>onPreviewChange({tags:event.target.value.split(',').map(x=>x.trim()).filter(Boolean)})}/></label>{modal.preview.entryCandidates.length>1&&<label className="form-field"><span>Entry page</span><select value={modal.preview.selectedEntry} onChange={event=>onPreviewChange({selectedEntry:event.target.value})}>{modal.preview.entryCandidates.map(x=><option key={x} value={x}>{x}</option>)}</select></label>}<div className="compatibility-box"><ShieldCheck size={17}/><span><b>{modal.preview.report.score==='likely'?'Likely to work offline':'Review compatibility notes'}</b><small>{modal.preview.report.findings.join(' ')}</small></span></div><div className="dialog-footer"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Use these details</button></div></>}
      {error&&<div className="dialog-error" role="alert">{error}</div>}
      {modal.kind!=='entry'&&<div className="dialog-footer"><button type="button" className="button" onClick={onClose}>{modal.kind==='share'&&modal.shareUrl?'Done':'Cancel'}</button>{modal.kind!=='share'||!modal.shareUrl?<button className="button primary" type="submit" disabled={busy||(modal.kind==='share'&&(modal.shareArchive?.size??0)>24*1024*1024)}>{modal.kind==='edit'?'Save details':modal.kind==='collect'?'Save collections':modal.kind==='collection'?'Create collection':modal.kind==='subject'?'Save subject':modal.kind==='share'?'Encrypt & create link':'Restore backup'}</button>:null}</div>}
    </form></motion.dialog></motion.div>;
}

function SharedPage({shareId,shareQuery,notify}:{shareId:string;shareQuery:string;notify:(message:string,error?:boolean)=>void}) {
  const [status,setStatus]=useState<'loading'|'ready'|'error'|'missing-key'>('loading'); const [message,setMessage]=useState('Checking this shared project…'); const [preview,setPreview]=useState<ImportPreview|null>(null); const [api,setApi]=useState(import.meta.env.VITE_SHARE_API_BASE??'');
  useEffect(()=>{const key=new URLSearchParams(shareQuery).get('k');if(!key){setStatus('missing-key');setMessage('The decryption key is missing from this link.');return;}if(!api){setStatus('error');setMessage('Online sharing is not configured for this LOCALDECK deployment.');return;}let cancelled=false;void (async()=>{try{const baseUrl=api.replace(/\/$/,'');const metaResponse=await fetch(`${baseUrl}/api/v1/shares/${encodeURIComponent(shareId)}`);if(!metaResponse.ok)throw new Error(metaResponse.status===410?'This share has expired or was revoked.':'This shared project could not be found.');const metadata=await metaResponse.json() as {status:string;expiresAt:string};if(metadata.status!=='active')throw new Error('This shared project is no longer available.');const response=await fetch(`${baseUrl}/api/v1/shares/${encodeURIComponent(shareId)}/blob`);if(!response.ok)throw new Error('The shared project could not be downloaded.');const clear=await decryptSharePackage(await response.arrayBuffer(),key);const file=new File([clear],`shared-${shareId}.zip`,{type:'application/zip'});const previews=await analyzeFiles([file]);if(cancelled)return;if(previews.length!==1)throw new Error('The shared archive did not contain a valid project.');setPreview(previews[0]);setStatus('ready');setMessage(`Shared project · expires ${friendlyDate(Date.parse(metadata.expiresAt))}`);}catch(error){if(cancelled)return;setStatus('error');setMessage(safeError(error));}})();return()=>{cancelled=true;};},[api,shareId,shareQuery]);
  const importShared=async()=>{if(!preview)return;try{await createItem(preview);notify(`“${preview.title}” was imported to this device.`);go('library');}catch(error){notify(safeError(error),true);}};
  const downloadShared=async()=>{if(!preview)return;try{const entries=await Promise.all(preview.files.map(async file=>({path:file.path,data:new Uint8Array(await file.blob.arrayBuffer())})));downloadBlob(await createStoredZip(entries),`${preview.title.replace(/[^a-z0-9_-]+/gi,'-')}.zip`);notify('Encrypted share decrypted and exported as a local ZIP copy.');}catch(error){notify(safeError(error),true);}};
  return <><PageHeading eyebrow="Private transfer" title="Shared project" description="This project is encrypted in transit and decrypted in this browser. Imported code remains isolated." />{status==='loading'?<div className="shared-state"><LoaderCircle className="spin" size={24}/><p>{message}</p></div>:status==='ready'&&preview?<div className="shared-card"><span className="preview-icon"><PreviewIcon type={preview.type}/></span><div><div className="eyebrow">{TYPE_LABEL[preview.type]} · {bytes(preview.storageSize)}</div><h2>{preview.title}</h2><p>{preview.description||'A project shared with you.'}</p><small>{message}</small></div><div className="shared-actions"><button className="button primary" onClick={()=>void importShared()}><Plus size={16}/> Import to my library</button><button className="button" onClick={()=>void downloadShared()}><ArrowDownToLine size={15}/> Download copy</button></div></div>:<div className="shared-error"><Info size={20}/><h2>{status==='missing-key'?'This link is incomplete':'This share is unavailable'}</h2><p>{message}</p></div>}{status==='error'&&<div className="share-setup panel"><h2>Sharing is not connected</h2><p>This is an optional service. To create and manage links, open Shared links and connect a Cloudflare Worker.</p><label className="form-field"><span>Worker API URL</span><input value={api} onChange={event=>setApi(event.target.value)} placeholder="https://your-worker.workers.dev"/></label><button className="button" onClick={()=>{if(!api.trim()){notify('Enter a Worker URL first.',true);return;}setStatus('loading');setMessage('Checking this shared project…');location.reload();}}>Retry this link</button></div>}</>;
}

function downloadBlob(blob:Blob,name:string) { const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),30_000); }

const rootElement=document.getElementById('root');
if (!rootElement) throw new Error('LOCALDECK could not start because its root element is missing.');
createRoot(rootElement).render(<React.StrictMode><App/></React.StrictMode>);


