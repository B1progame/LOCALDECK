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

  const createEncryptedShare = async (archive: Blob, apiValue: string, token: string, days: number) => {
    if (!apiValue.trim() || !token.trim()) throw new Error('Enter the Worker URL and owner token first.');
    const { payload, fragmentKey } = await encryptSharePackage(archive);
    const apiBase = apiValue.trim().replace(/\/$/, '');
    const response = await fetch(`${apiBase}/api/v1/shares`, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'content-type':'application/octet-stream', 'x-share-expires-in':String(days) }, body:payload });
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
          const result = await createEncryptedShare(modal.shareArchive, String(form.get('api')), String(form.get('token')), Number(form.get('expiresIn')));
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
          {currentPage === 'collections' && (route.collectionId ? <CollectionDetail collection={collections.find(x=>x.id===route.collectionId)} items={pageItems} onBack={()=>go('collections')} open={openProject} favorite={async item=>{try{await toggleFavorite(item.id);await refresh();}catch(error){notify(safeError(error),true);}}} onChange={async (collectionId,ordered)=>{await updateCollection(collectionId,{orderedItemIds:ordered});await refresh();}} onRemove={async item=>{if(!route.collectionId)return;await removeFromCollection(item.id,route.collectionId);await refresh();notify('Project removed from this collection.');}} /> : <CollectionsPage collections={collections} items={items} add={() => setModal({ kind:'collection' })} open={id => go('collections', `?collection=${encodeURIComponent(id)}`)} remove={async collection => { if (!window.confirm(`Delete the “${collection.name}” collection? Projects stay in your library.`)) return; await deleteCollection(collection.id); await refresh(); notify('Collection deleted.'); }} />)}
          {currentPage === 'import' && <ImportPage previews={importPreviews} busy={busy} addFiles={() => fileInput.current?.click()} addFolder={() => folderInput.current?.click()} save={savePreview} discard={preview => setImportPreviews(list => list.filter(x => x !== preview))} editPreview={preview => setModal({ kind:'entry',preview })} onDrop={files=>void handlePickedFiles(files)} />}
          {currentPage === 'studio' && <StudioPage subjects={subjects} addSubject={() => setModal({ kind:'subject' })} notify={notify} />}
          {currentPage === 'storage' && <StoragePage items={items} storage={storage} integrity={integrity} busy={busy} backup={performBackup} restore={() => restoreInput.current?.click()} requestPersistent={requestPersistentStorage} checkIntegrity={checkIntegrity} repair={runRepair} />}
          {currentPage === 'sharing' && <SharingPage notify={notify} />}
          {currentPage === 'settings' && <SettingsPage reducedMotion={reducedMotion} onMotion={async value => { setReducedMotion(value); await db.settings.put({ id:'reduced-motion', value, updatedAt:Date.now() }); }} />}
          {currentPage === 'shared' && <SharedPage shareId={route.shareId ?? ''} shareQuery={route.shareQuery ?? ''} notify={notify} />}
        </motion.div>
      </AnimatePresence>
    </main>
    <AnimatePresence>{toast && <motion.div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'} initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:6 }}><span className="toast-icon">{toast.error ? '!' : '✓'}</span>{toast.message}</motion.div>}</AnimatePresence>
    <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} value={query} onChange={setQuery} items={items} onOpen={item => { setSearchOpen(false); void openProject(item); }} />
    <AnimatePresence>{modal && <Modal modal={modal} collections={collections} busy={busy} onClose={() => { setModal(null); setDialogError(''); }} onSubmit={saveModal} error={dialogError} onPreviewChange={(update) => setModal(current => current?.preview ? { ...current, preview: { ...current.preview, ...update } } : current)} />}</AnimatePresence>
    <AnimatePresence>{playing && <Player key={playing.id} item={playing} close={closePlayer} onOpened={playerOpened} />}</AnimatePresence>
  </div></MotionConfig>;
}

function NavItem({ page, active, label, icon: Icon, count, onNavigate }: { page: Page; active: boolean; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; count?: number; onNavigate?: () => void }) {
  return <a href={`#/${page}`} onClick={onNavigate} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}><Icon size={17} strokeWidth={active ? 2.15 : 1.8} /><span>{label}</span>{count !== undefined && <small>{count}</small>}</a>;
}

function StorageMini({ storage, items }: { storage: { usage?: number; quota?: number; persisted?: boolean }; items: LibraryItem[] }) {
  const total = items.reduce((sum,item)=>sum+item.storageSize,0), ratio = storage.quota ? Math.min(100,(storage.usage ?? total) / storage.quota * 100) : 0;
  return <div className="storage-mini"><div><i className="status-dot" /> <span>Stored on this device</span></div><div className="storage-track"><i style={{ width: `${Math.max(ratio, .4)}%` }} /></div><small><span>{bytes(total)} in projects</span><span>{storage.persisted ? 'Protected' : 'Local'}</span></small></div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>;
}

function HomePage({ items, open, add, navigate, favorite }: { items: LibraryItem[]; open: (item: LibraryItem) => void; add: () => void; navigate: (page: Page) => void; favorite:(item:LibraryItem)=>void }) {
  const featured = items.find(item => item.favorite) ?? items[0];
  const recent = [...items].filter(item => item.lastOpenedAt).sort((a,b)=>(b.lastOpenedAt??0)-(a.lastOpenedAt??0)).slice(0,4);
  return <>
    <PageHeading eyebrow="Your personal space" title="Good to have you here." description="Everything you learn, make and love, saved in one place." action={<><button className="button" onClick={() => navigate('studio')}><Sparkles size={16} /> AI studio</button><button className="button primary" onClick={add}><Plus size={17} /> Import</button></>} />
    <section className="hero-banner">
      <div className="hero-copy"><div className="hero-kicker"><i /> Private by design</div><h2>{featured ? `Welcome back to ${featured.title}.` : 'Your world, all in one place.'}</h2><p>{featured ? 'Pick up where you left off, or make room for something new.' : 'Bring together learning sheets, games, tools and ideas. Your library stays on this device.'}</p><button className="button hero-button" onClick={() => featured ? open(featured) : navigate('import')}>{featured ? 'Continue where you left off' : 'Bring something in'} <ArrowRight size={16} /></button></div>
      <div className="hero-art" aria-hidden="true"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-core"><img src={`${base}icon-512.png`} alt="" /></div><span className="hero-spark">✦</span></div>
    </section>
    <section className="section-block"><div className="section-title-row"><div><h2>Make yourself at home</h2><p>A few useful ways to begin</p></div></div><div className="start-list">
      <button className="start-item" onClick={add}><span className="start-icon violet"><Upload size={18} /></span><span><b>Bring in a project</b><small>HTML, ZIP, PDF or a folder</small></span><ArrowRight size={16} /></button>
      <button className="start-item" onClick={() => navigate('learning')}><span className="start-icon mint"><BookOpen size={18} /></span><span><b>Make a learning space</b><small>Keep study material together</small></span><ArrowRight size={16} /></button>
      <button className="start-item" onClick={() => navigate('studio')}><span className="start-icon peach"><Sparkles size={18} /></span><span><b>Prepare with AI studio</b><small>Build a project prompt and manifest</small></span><ArrowRight size={16} /></button>
    </div></section>
    {recent.length > 0 && <section className="section-block"><div className="section-title-row"><div><h2>Pick up where you left off</h2><p>Your recently opened projects</p></div><button className="text-button" onClick={() => navigate('recent')}>See all <ArrowRight size={15} /></button></div><div className="item-grid">{recent.map((item,index)=><ItemCard key={item.id} item={item} index={index} onOpen={()=>open(item)} onFavorite={()=>favorite(item)} onEdit={()=>{}} onDelete={()=>{}} onExport={()=>{}} onDuplicate={()=>{}} simple compact />)}</div></section>}
    <section className="section-block"><div className="section-title-row"><div><h2>Explore your space</h2><p>{items.length ? `${items.length} project${items.length===1?'':'s'} saved in your library` : 'A place for the things you want to keep close'}</p></div></div><div className="explore-row"><ExploreTile icon={Library} title="Everything" detail={`${items.length} items`} color="violet" onClick={()=>navigate('library')} /><ExploreTile icon={BookOpen} title="Learning" detail="Notes & interactive lessons" color="mint" onClick={()=>navigate('learning')} /><ExploreTile icon={Gamepad2} title="Games & apps" detail="Things to play and use" color="peach" onClick={()=>navigate('games')} /><ExploreTile icon={Archive} title="Collections" detail={`${collectionsCount(items)} organized`} color="blue" onClick={()=>navigate('collections')} /></div></section>
    <footer className="page-footer">Made for your things <span>·</span> Saved on this device <span>·</span> Yours to keep</footer>
  </>;
}
function collectionsCount(items: LibraryItem[]) { return new Set(items.flatMap(x=>x.collectionIds)).size; }
function ExploreTile({ icon:Icon,title,detail,color,onClick }: { icon: typeof Library; title:string; detail:string; color:string; onClick:()=>void }) { return <button className="explore-tile" onClick={onClick}><span className={`start-icon ${color}`}><Icon size={17}/></span><span><b>{title}</b><small>{detail}</small></span></button>; }

function LibraryPage({ page, items, query, setQuery, sort, setSort, open, edit, collect, share, remove, favorite, exportOne, duplicate }: {
  page: Page; items: LibraryItem[]; query:string; setQuery:(value:string)=>void; sort:ItemSort; setSort:(value:ItemSort)=>void;
  open:(item:LibraryItem)=>void; edit:(item:LibraryItem)=>void; collect:(item:LibraryItem)=>void; share:(item:LibraryItem)=>void; remove:(item:LibraryItem)=>void; favorite:(item:LibraryItem)=>void;
  exportOne:(item:LibraryItem)=>void; duplicate:(item:LibraryItem)=>void;
}) {
  const meta: Record<string,{ kicker:string; title:string; description:string }> = {
    library:{kicker:'Your library',title:'All items',description:'The projects and ideas you have saved here.'},
    favorites:{kicker:'Close at hand',title:'Favorites',description:'A short list of things you want to find quickly.'},
    recent:{kicker:'Your recent activity',title:'Recently opened',description:'Pick up from the last thing you opened.'},
    learning:{kicker:'Your learning space',title:'Learning hub',description:'Study sheets, lessons, quizzes, and subject notes.'},
    games:{kicker:'Play & explore',title:'Games & apps',description:'Games, tools, simulations, and small applications.'},
  };
  const [typeFilter,setTypeFilter]=useState('all');
  const shown=typeFilter==='all'?items:items.filter(item=>item.type===typeFilter);
  const metaFor=meta[page];
  return <>
    <PageHeading eyebrow={metaFor.kicker} title={metaFor.title} description={metaFor.description} action={<button className="button primary" onClick={()=>go('import')}><Plus size={17}/> Import</button>} />
    <div className="library-toolbar"><label className="field-search"><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={`Search ${metaFor.title.toLowerCase()}…`} aria-label={`Search ${metaFor.title}`} />{query && <button aria-label="Clear search" onClick={()=>setQuery('')}><X size={15}/></button>}</label><label className="select-wrap"><ListFilter size={15}/><select aria-label="Sort projects" value={sort} onChange={event=>setSort(event.target.value as ItemSort)}><option value="imported">Recently added</option><option value="name">Name</option><option value="opened">Last opened</option><option value="size">File size</option><option value="modified">Recently modified</option></select><ChevronDown size={14}/></label><label className="select-wrap type-select"><select aria-label="Filter by type" value={typeFilter} onChange={event=>setTypeFilter(event.target.value)}><option value="all">All types</option>{Object.entries(TYPE_LABEL).map(([type,label])=><option key={type} value={type}>{label}</option>)}</select><ChevronDown size={14}/></label></div>
    {shown.length ? <div className="item-grid">{shown.map((item,index)=><ItemCard key={item.id} item={item} index={index} onOpen={()=>open(item)} onFavorite={()=>favorite(item)} onEdit={()=>edit(item)} onCollect={()=>collect(item)} onShare={()=>share(item)} onDelete={()=>remove(item)} onExport={()=>exportOne(item)} onDuplicate={()=>duplicate(item)} />)}</div> : <EmptyState icon={page==='favorites'?Heart:page==='recent'?Clock3:page==='learning'?BookOpen:Library} title={query?'No matches found':page==='favorites'?'Nothing saved as a favorite yet':page==='recent'?'Your recent projects will appear here':'Your library is ready for its first project'} detail={query?'Try a different title, subject, or tag.':page==='favorites'?'Tap the heart on a project to keep it close.':page==='recent'?'Open something from your library and it will be waiting here.':'Import an HTML project, ZIP, PDF, or folder. Everything stays on this device.'} action={<button className="button primary" onClick={()=>go('import')}><Plus size={16}/> Import a project</button>} />}
  </>;
}

function ItemCard({ item,index,onOpen,onFavorite,onEdit,onCollect,onShare,onDelete,onExport,onDuplicate,compact=false,simple=false }: { item:LibraryItem; index:number; onOpen:()=>void; onFavorite:()=>void; onEdit:()=>void; onCollect?:()=>void; onShare?:()=>void; onDelete:()=>void; onExport:()=>void; onDuplicate:()=>void; compact?:boolean; simple?:boolean }) {
  const [menu,setMenu]=useState(false); const Icon=TYPE_ICON[item.type];
  return <motion.article className={`item-card ${compact?'item-card-compact':''}`} layout initial={{opacity:0,y:7}} animate={{opacity:1,y:0}} transition={{duration:.2,delay:Math.min(index*.025,.18)}}>
    <button className={`item-cover cover-${item.type}`} onClick={onOpen} aria-label={`Open ${item.title}`}><span className="cover-type"><Icon size={21}/></span><span className="cover-title">{item.title}</span><span className="cover-meta">{item.subject || TYPE_LABEL[item.type]}</span><span className="cover-play"><Play size={14} fill="currentColor"/></span>{item.artworkReferences.cover && <span className="cover-art" style={{backgroundImage:`url("${formatRoutePath(item.id,item.artworkReferences.cover)}")`}} aria-hidden="true" />}</button>
    <div className="item-info"><div className="item-title-row"><button className="item-title-button" onClick={onOpen}><b>{item.title}</b><small>{TYPE_LABEL[item.type]}{item.subject ? ` · ${item.subject}` : ''}</small></button><button className={`icon-button favorite-button ${item.favorite?'favorite-on':''}`} onClick={onFavorite} aria-label={`${item.favorite?'Remove':'Add'} ${item.title} ${item.favorite?'from':'to'} favorites`}><Heart size={17} fill={item.favorite?'currentColor':'none'}/></button>{!simple&&<button className="icon-button item-menu-button" onClick={()=>setMenu(value=>!value)} aria-expanded={menu} aria-label={`More actions for ${item.title}`}><MoreHorizontal size={18}/></button>}</div>
      <div className="item-foot"><span>{bytes(item.storageSize)}</span><span>{item.fileCount} file{item.fileCount===1?'':'s'}</span></div>
      {menu && <><button className="menu-dismiss" aria-label="Close project menu" onClick={()=>setMenu(false)} /><div className="item-menu" role="menu"><button role="menuitem" onClick={()=>{setMenu(false);onEdit();}}>Edit details</button><button role="menuitem" onClick={()=>{setMenu(false);onCollect?.();}}>Add to collection</button><button role="menuitem" onClick={()=>{setMenu(false);onShare?.();}}><Share2 size={14}/> Create encrypted link</button><button role="menuitem" onClick={()=>{setMenu(false);onDuplicate();}}>Make a copy</button><button role="menuitem" onClick={()=>{setMenu(false);onExport();}}>Export project</button><button role="menuitem" className="danger-menu" onClick={()=>{setMenu(false);onDelete();}}>Remove from library</button></div></>}
    </div>
  </motion.article>;
}

function EmptyState({icon:Icon,title,detail,action}:{icon:typeof Library;title:string;detail:string;action?:React.ReactNode}) { return <div className="empty-state"><div className="empty-icon"><Icon size={21}/></div><h2>{title}</h2><p>{detail}</p>{action}</div>; }

function CollectionsPage({ collections,items,add,open,remove }: { collections:Collection[]; items:LibraryItem[]; add:()=>void; open:(id:string)=>void; remove:(value:Collection)=>void }) {
  return <><PageHeading eyebrow="Organize your library" title="Collections" description="Group projects around a subject, class, or moment." action={<button className="button primary" onClick={add}><FolderPlus size={17}/> New collection</button>} />
    {collections.length ? <div className="collection-list">{collections.map(collection=>{ const count=items.filter(item=>item.collectionIds.includes(collection.id)).length; return <div className="collection-row" key={collection.id}><button className="collection-main" onClick={()=>open(collection.id)}><span className="collection-swatch" style={{background:collection.accentColor}}><Archive size={18}/></span><span><b>{collection.name}</b><small>{collection.description || `${count} project${count===1?'':'s'}`}</small></span><span className="collection-count">{count}</span><ArrowRight size={16}/></button><button className="icon-button" aria-label={`Delete ${collection.name}`} onClick={()=>remove(collection)}><Trash2 size={16}/></button></div>; })}</div> : <EmptyState icon={Archive} title="Make a collection of your own" detail="Keep projects together by class, topic, or whatever makes sense to you." action={<button className="button primary" onClick={add}><Plus size={16}/> New collection</button>} />}
  </>;
}

function CollectionDetail({collection,items,onBack,open,favorite,onChange,onRemove}:{collection?:Collection;items:LibraryItem[];onBack:()=>void;open:(item:LibraryItem)=>void;favorite:(item:LibraryItem)=>void;onChange:(collectionId:string,ordered:string[])=>void;onRemove:(item:LibraryItem)=>void}) {
  if(!collection)return <EmptyState icon={Archive} title="This collection is unavailable" detail="It may have been removed from this browser." action={<button className="button" onClick={onBack}><ArrowLeft size={15}/> All collections</button>}/>;
  const order=new Map(collection.orderedItemIds.map((id,index)=>[id,index]));
  const ordered=[...items].sort((a,b)=>(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER)||a.title.localeCompare(b.title));
  const move=(item:LibraryItem,delta:number)=>{const next=[...ordered];const from=next.findIndex(x=>x.id===item.id),to=from+delta;if(from<0||to<0||to>=next.length)return;[next[from],next[to]]=[next[to],next[from]];onChange(collection.id,next.map(x=>x.id));};
  return <><button className="text-button back-link" onClick={onBack}><ArrowLeft size={15}/> All collections</button><div className="collection-detail-head"><span className="collection-swatch" style={{background:collection.accentColor}}><Archive size={19}/></span><div><h2>{collection.name}</h2><p>{collection.description||`${ordered.length} project${ordered.length===1?'':'s'} · drag-free manual ordering`}</p></div><button className="button" onClick={()=>go('import')}><Plus size={15}/> Import</button></div>{ordered.length?<div className="collection-projects">{ordered.map((item,index)=><div className="collection-project" key={item.id}><div className="order-controls"><button disabled={index===0} aria-label={`Move ${item.title} up`} onClick={()=>move(item,-1)}>↑</button><button disabled={index===ordered.length-1} aria-label={`Move ${item.title} down`} onClick={()=>move(item,1)}>↓</button></div><button className="collection-project-main" onClick={()=>open(item)}><span className={`mini-cover cover-${item.type}`}><PreviewIcon type={item.type}/></span><span><b>{item.title}</b><small>{TYPE_LABEL[item.type]}{item.subject?` · ${item.subject}`:''}</small></span><ArrowRight size={15}/></button><button className={`icon-button ${item.favorite?'favorite-on':''}`} aria-label={`${item.favorite?'Remove':'Add'} ${item.title} ${item.favorite?'from':'to'} favorites`} onClick={()=>favorite(item)}><Heart size={16} fill={item.favorite?'currentColor':'none'}/></button><button className="icon-button" aria-label={`Remove ${item.title} from this collection`} onClick={()=>onRemove(item)}><X size={16}/></button></div>)}</div>:<EmptyState icon={Archive} title="This collection is ready" detail="Add projects from your library with the project menu, or import something new." action={<button className="button primary" onClick={()=>go('library')}><Library size={15}/> Browse library</button>}/>}</>;
}

function ImportPage({previews,busy,addFiles,addFolder,save,discard,editPreview,onDrop}:{previews:ImportPreview[];busy:boolean;addFiles:()=>void;addFolder:()=>void;save:(preview:ImportPreview)=>void;discard:(preview:ImportPreview)=>void;editPreview:(preview:ImportPreview)=>void;onDrop:(files:File[])=>void}) {
  return <><PageHeading eyebrow="Bring your projects with you" title="Import center" description="Choose files or a folder. They are inspected locally, and nothing is saved until you confirm." />
    <div className="import-drop" onDragOver={event=>{event.preventDefault();event.currentTarget.classList.add('drag-over');}} onDragLeave={event=>event.currentTarget.classList.remove('drag-over')} onDrop={event=>{event.preventDefault();event.currentTarget.classList.remove('drag-over');const files=[...event.dataTransfer.files];if(files.length)onDrop(files);}}>
      <span className="drop-icon">{busy?<LoaderCircle size={24} className="spin"/>:<Upload size={23}/>}</span><h2>{busy?'Inspecting your files…':'Bring in something you made'}</h2><p>HTML pages, complete ZIP projects, PDFs, or a whole folder. Files stay in this browser.</p><div className="drop-actions"><button className="button primary" onClick={addFiles}><Upload size={16}/> Choose files</button><button className="button" onClick={addFolder}>Choose a folder</button></div><small>80 MB ZIP · 120 MB expanded project · 50 MB per file</small>
    </div>
    <div className="privacy-note"><ShieldCheck size={17}/><span><b>Private by default</b><small>Importing never sends your projects to a server. You choose explicitly if you ever share one.</small></span></div>
    {previews.length>0 && <section className="preview-section"><div className="section-title-row"><div><h2>Ready to add</h2><p>Review details and choose the entry page before saving.</p></div></div><div className="preview-list">{previews.map((preview,index)=><div className="preview-row" key={`${preview.sourceName}-${index}`}><span className="preview-icon"><PreviewIcon type={preview.type}/></span><div className="preview-copy"><b>{preview.title}</b><small>{preview.sourceName} · {bytes(preview.storageSize)} · {preview.files.length} file{preview.files.length===1?'':'s'}</small><small className={`compat-${preview.report.score}`}>{preview.report.score==='likely'?'Likely to work offline':'May need network or unsupported browser features'}</small>{preview.entryCandidates.length>1&&<button className="inline-link" onClick={()=>editPreview(preview)}>Choose entry page ({preview.entryCandidates.length} found)</button>}{preview.warnings.map(w=><small className="warning-text" key={w}><Info size={13}/>{w}</small>)}</div><div className="preview-actions"><button className="button subtle" onClick={()=>editPreview(preview)}>Edit details</button><button className="button primary" disabled={busy} onClick={()=>save(preview)}>Add to library</button><button className="icon-button" aria-label={`Discard ${preview.title}`} onClick={()=>discard(preview)}><X size={17}/></button></div></div>)}</div></section>}
    <section className="import-guidance"><h2>What works best</h2><p>ZIP projects keep their folders and relative asset paths. Put <code>localdeck.json</code> next to the entry page for metadata, or add a JSON manifest in the page. Local-only projects usually work offline; projects that need a server or remote APIs may not.</p></section>
  </>;
}
function PreviewIcon({type}:{type:ContentType}) { const Icon=TYPE_ICON[type]; return <Icon size={19}/>; }

function StudioPage({subjects,addSubject,notify}:{subjects:Subject[];addSubject:()=>void;notify:(message:string,error?:boolean)=>void}) {
  const [name,setName]=useState(''); const [type,setType]=useState<ContentType>('learning'); const [subject,setSubject]=useState(''); const [details,setDetails]=useState(''); const [output,setOutput]=useState(''); const [manifest,setManifest]=useState('');
  const generate=()=>{
    const title=name.trim()||'Untitled project';
    const description=details.trim()||'Create a clear, useful project that works offline.';
    const metadata={schemaVersion:1,title,type,description,subject:subject.trim(),tags:[],offlineIntent:true,format:'html'};
    const prompt=`Build a responsive ${TYPE_LABEL[type].toLocaleLowerCase()} called “${title}”.\n\nPURPOSE\n${description}\n\n${subject?`SUBJECT\n${subject}\n\n`:''}LOCALDECK PACKAGE\n- Provide a ZIP with a clear entry HTML page and all local assets in relative folders.\n- Include the attached localdeck.json metadata.\n- Keep the project usable offline: do not depend on remote fonts, scripts, images, analytics, or APIs.\n- Include controls and a short README.\n\nQUALITY\nUse semantic HTML, accessible contrast, keyboard and touch support, responsive layout, and honor reduced-motion preferences. Test relative CSS, scripts, and images from the entry page.\n\nLOCALDECK METADATA\n${JSON.stringify(metadata,null,2)}\n\nSUGGESTED STRUCTURE\nindex.html\nstyles/main.css\nscripts/app.js\nassets/`;
    setManifest(JSON.stringify(metadata,null,2)); setOutput(prompt);
  };
  const copy=async()=>{try{await navigator.clipboard.writeText(output);notify('Project prompt copied.');}catch{notify('Clipboard access is unavailable. Select and copy the prompt manually.',true);}};
  return <><PageHeading eyebrow="Local project tools" title="AI studio" description="Create a ready-to-use brief and valid LocalDeck metadata without calling an AI service." />
    <div className="studio-grid"><form className="panel studio-form" onSubmit={event=>{event.preventDefault();generate();}}><div className="panel-heading"><span className="panel-icon"><Sparkles size={18}/></span><div><h2>Project brief</h2><p>Describe what you want to make.</p></div></div><label className="form-field"><span>Project name</span><input value={name} onChange={event=>setName(event.target.value)} placeholder="e.g. Derivative practice" /></label><label className="form-field"><span>Type</span><select value={type} onChange={event=>setType(event.target.value as ContentType)}>{Object.entries(TYPE_LABEL).filter(([key])=>key!=='other').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="form-field"><span>Subject or category</span><div className="inline-field"><input list="subject-options" value={subject} onChange={event=>setSubject(event.target.value)} placeholder="e.g. Mathematics"/><datalist id="subject-options">{subjects.map(x=><option key={x.id}>{x.name}</option>)}</datalist><button type="button" className="button subtle" onClick={addSubject}>Add</button></div></label><label className="form-field"><span>Purpose and details</span><textarea rows={5} value={details} onChange={event=>setDetails(event.target.value)} placeholder="What should it teach, show, or help someone do?" /></label><button className="button primary" type="submit"><Sparkles size={16}/> Generate prompt & metadata</button></form>
      <section className="panel studio-output"><div className="panel-heading"><span className="panel-icon mint"><FileText size={18}/></span><div><h2>Ready to use</h2><p>Generated locally. No model inference is happening.</p></div></div>{output?<><div className="output-heading"><b>Development prompt</b><button className="text-button" onClick={()=>void copy()}><Copy size={15}/> Copy</button></div><pre className="prompt-output">{output}</pre><div className="output-heading"><b>Manifest JSON</b><button className="text-button" onClick={async()=>{try{await navigator.clipboard.writeText(manifest);notify('Manifest copied.');}catch{notify('Clipboard access is unavailable.',true);}}}><Copy size={15}/> Copy</button></div><pre className="manifest-output">{manifest}</pre></>:<div className="output-empty"><Sparkles size={20}/><p>Fill in a few details, then generate your project brief and a valid metadata file.</p></div>}</section>
    </div><div className="privacy-note"><ShieldCheck size={17}/><span><b>Offline and private</b><small>Prompt generation and metadata validation happen in your browser. You decide whether to paste the brief into an external AI tool.</small></span></div>
  </>;
}

function StoragePage({items,storage,integrity,busy,backup,restore,requestPersistent,checkIntegrity,repair}:{items:LibraryItem[];storage:{usage?:number;quota?:number;persisted?:boolean};integrity:{orphanAssetCount:number;incompleteItemIds:string[]}|null;busy:boolean;backup:()=>void;restore:()=>void;requestPersistent:()=>void;checkIntegrity:()=>void;repair:()=>void}) {
  const byType=Object.entries(items.reduce<Record<string,number>>((total,item)=>{total[item.type]=(total[item.type]??0)+item.storageSize;return total;},{})).sort((a,b)=>b[1]-a[1]);
  const projectBytes=items.reduce((sum,item)=>sum+item.storageSize,0);
  return <><PageHeading eyebrow="Your device" title="Storage & backups" description="Keep track of local space and export a copy before moving browsers or devices." action={<button className="button primary" disabled={busy||!items.length} onClick={backup}><Archive size={16}/> Export library</button>} />
    <div className="storage-overview"><div className="storage-total"><small>Project files</small><strong>{bytes(projectBytes)}</strong><span>{items.length} saved item{items.length===1?'':'s'}</span></div><div className="storage-quota"><div className="quota-top"><span>Browser storage estimate</span><b>{storage.usage!==undefined?bytes(storage.usage):'Not available'}{storage.quota?` of ${bytes(storage.quota)}`:''}</b></div><div className="quota-track"><i style={{width:`${storage.quota?Math.min(100,(storage.usage??0)/storage.quota*100):0}%`}}/></div><p>{storage.persisted?'The browser has marked this site’s data as persistent.':'Browser data can be cleared or evicted. A backup is the only portable copy.'}</p><button className="text-button" onClick={requestPersistent}>{storage.persisted?'Storage persistence requested':'Request persistent storage'}</button></div></div>
    <div className="storage-actions"><div className="panel"><span className="panel-icon violet"><ArrowDownToLine size={18}/></span><h2>Restore a backup</h2><p>Merge projects from a LOCALDECK backup. Matching project IDs are kept as separate copies.</p><button className="button" disabled={busy} onClick={restore}>Choose a backup ZIP</button></div><div className="panel"><span className="panel-icon mint"><ShieldCheck size={18}/></span><h2>Check library integrity</h2><p>Find project records with missing files and assets left behind by interrupted operations.</p><div className="row-actions"><button className="button" onClick={checkIntegrity}>Run check</button>{integrity&&(integrity.orphanAssetCount||integrity.incompleteItemIds.length)?<button className="button danger-button" onClick={repair}>Repair storage</button>:null}</div>{integrity&&<small className={integrity.orphanAssetCount||integrity.incompleteItemIds.length?'warning-text':'success-text'}>{integrity.orphanAssetCount} orphaned files · {integrity.incompleteItemIds.length} incomplete projects</small>}</div></div>
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
      {modal.kind==='share'&&!modal.shareUrl&&<><div className="privacy-note"><ShieldCheck size={17}/><span><b>Encrypted before upload</b><small>The project ZIP is encrypted in your browser. The link key stays in the URL fragment and is never sent to the sharing server. Recipients can keep a copy after downloading.</small></span></div><div className="share-item-summary"><span className="preview-icon"><PreviewIcon type={modal.item!.type}/></span><span><b>{modal.item!.title}</b><small>{TYPE_LABEL[modal.item!.type]} · ZIP package {bytes(modal.shareArchive?.size ?? 0)} · 50 MB upload limit</small></span></div>{(modal.shareArchive?.size ?? 0)>50*1024*1024&&<p className="warning-text">This ZIP is too large for encrypted sharing. Export the project and reduce its size before trying again.</p>}<label className="form-field"><span>Cloudflare Worker URL</span><input name="api" defaultValue={import.meta.env.VITE_SHARE_API_BASE??''} placeholder="https://your-worker.workers.dev" required type="url"/></label><label className="form-field"><span>Owner token</span><input name="token" type="password" autoComplete="off" required/></label><label className="form-field"><span>Link expires after</span><select name="expiresIn" defaultValue="7"><option value={String(1/24)}>1 hour</option><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label></>}
      {modal.kind==='share'&&modal.shareUrl&&<div className="share-created"><span className="share-created-icon"><Check size={20}/></span><h3>Your encrypted link is ready</h3><p>Anyone with this complete link can import <b>{modal.item?.title}</b> until it expires. Keep the link somewhere private.</p><div className="share-link-field"><input readOnly value={modal.shareUrl} aria-label="Encrypted share link"/><button type="button" className="button primary" onClick={()=>void navigator.clipboard.writeText(modal.shareUrl!).catch(()=>{})}><Copy size={15}/> Copy</button></div></div>}
      {modal.kind==='entry'&&modal.preview&&<><label className="form-field"><span>Project name</span><input value={modal.preview.title} onChange={event=>onPreviewChange({title:event.target.value})} required maxLength={120}/></label><label className="form-field"><span>Type</span><select value={modal.preview.type} onChange={event=>onPreviewChange({type:event.target.value as ContentType})}>{Object.entries(TYPE_LABEL).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="form-field"><span>Subject or category</span><input value={modal.preview.subject} onChange={event=>onPreviewChange({subject:event.target.value})}/></label><label className="form-field"><span>Topic</span><input value={modal.preview.topic} onChange={event=>onPreviewChange({topic:event.target.value})}/></label><label className="form-field"><span>Description</span><textarea rows={3} value={modal.preview.description} onChange={event=>onPreviewChange({description:event.target.value})}/></label><label className="form-field"><span>Tags, separated by commas</span><input value={modal.preview.tags.join(', ')} onChange={event=>onPreviewChange({tags:event.target.value.split(',').map(x=>x.trim()).filter(Boolean)})}/></label>{modal.preview.entryCandidates.length>1&&<label className="form-field"><span>Entry page</span><select value={modal.preview.selectedEntry} onChange={event=>onPreviewChange({selectedEntry:event.target.value})}>{modal.preview.entryCandidates.map(x=><option key={x} value={x}>{x}</option>)}</select></label>}<div className="compatibility-box"><ShieldCheck size={17}/><span><b>{modal.preview.report.score==='likely'?'Likely to work offline':'Review compatibility notes'}</b><small>{modal.preview.report.findings.join(' ')}</small></span></div><div className="dialog-footer"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Use these details</button></div></>}
      {error&&<div className="dialog-error" role="alert">{error}</div>}
      {modal.kind!=='entry'&&<div className="dialog-footer"><button type="button" className="button" onClick={onClose}>{modal.kind==='share'&&modal.shareUrl?'Done':'Cancel'}</button>{modal.kind!=='share'||!modal.shareUrl?<button className="button primary" type="submit" disabled={busy||(modal.kind==='share'&&(modal.shareArchive?.size??0)>50*1024*1024)}>{modal.kind==='edit'?'Save details':modal.kind==='collect'?'Save collections':modal.kind==='collection'?'Create collection':modal.kind==='subject'?'Save subject':modal.kind==='share'?'Encrypt & create link':'Restore backup'}</button>:null}</div>}
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

