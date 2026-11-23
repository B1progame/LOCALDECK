/* LocalDeck browsing screens: home, library views, collections and project details. */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive, ArrowLeft, ArrowRight, BookOpen, Clock3, Code2, FileText, FolderPlus, Gamepad2, Heart, LayoutGrid,
  Library, List, ListFilter, MoreHorizontal, Pencil, Play, Plus, Search, Share2, ShieldCheck, Sparkles, Upload, X,
  type LucideIcon,
} from 'lucide-react';
import { db } from './services/database';
import { getAssets, type ItemSort } from './services/library';
import type { Collection, ContentType, LibraryAsset, LibraryItem } from './types';
import {
  Chips, EmptyState, ItemCard, ItemMenu, ItemRow, LEARNING_TYPES, OPEN_VERB, PLAY_TYPES, PageHeading, Shelf, TYPE_ICON, TYPE_LABEL,
  base, bytes, colorFor, coverBackground, friendlyDate, go, isHtmlItem, itemSubtitle, useItemActions, type Page,
} from './shared';

type View = 'grid' | 'list';
const VIEW_KEY = 'localdeck-library-view';
function readView(): View { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } }

const byOpened = (a: LibraryItem, b: LibraryItem) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0);
const byImported = (a: LibraryItem, b: LibraryItem) => b.importedAt - a.importedAt;
const SORTERS: Record<ItemSort, (a: LibraryItem, b: LibraryItem) => number> = {
  name: (a, b) => a.title.localeCompare(b.title), imported: byImported, opened: byOpened,
  size: (a, b) => b.storageSize - a.storageSize, modified: (a, b) => b.updatedAt - a.updatedAt,
};
const matches = (item: LibraryItem, q: string) => [item.title, item.description, item.type, item.subject, item.topic, item.genre, ...item.tags].join(' ').toLocaleLowerCase().includes(q.toLocaleLowerCase());

function dayGroup(ts: number): string {
  const day = new Date(ts); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'Earlier this week';
  if (diff < 31) return 'Earlier this month';
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(ts);
}
const timeOf = (ts: number) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(ts);

/* ---------- Home ---------- */

export function HomePage({ items, collections, add, tryDemos }: { items: LibraryItem[]; collections: Collection[]; add: () => void; tryDemos?: () => void }) {
  const a = useItemActions();
  const recent = useMemo(() => items.filter(item => item.lastOpenedAt).sort(byOpened), [items]);
  const featured = recent[0] ?? items.find(item => item.favorite) ?? [...items].sort(byImported)[0];
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night.' : hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';
  const art = featured ? coverBackground(featured) : '';
  const FeaturedIcon = featured ? TYPE_ICON[featured.type] : Sparkles;
  const favorites = items.filter(item => item.favorite);
  const added = [...items].sort(byImported);
  const learning = items.filter(item => LEARNING_TYPES.includes(item.type)).sort(byImported);
  const play = items.filter(item => PLAY_TYPES.includes(item.type)).sort(byImported);
  return <>
    <PageHeading title={greeting} description={items.length ? `${items.length} project${items.length === 1 ? '' : 's'} in your library, saved on this device.` : 'Everything you learn, make and love, saved on this device.'}
      action={<><button className="button" onClick={() => go('studio')}><Sparkles size={16}/> AI studio</button><button className="button primary" onClick={add}><Plus size={17}/> Import</button></>} />
    <section className={`hero-banner ${featured ? 'has-art' : ''}`}>
      {featured && <span className="hero-backdrop" style={{ backgroundImage: art }} aria-hidden="true" />}
      <div className="hero-copy">
        <div className="hero-kicker"><i /> {featured ? (featured.lastOpenedAt ? 'Continue where you left off' : featured.favorite ? 'One of your favorites' : 'Recently added') : 'Private by design'}</div>
        <h2>{featured ? featured.title : 'Your world, all in one place.'}</h2>
        <p>{featured ? (featured.description || `${TYPE_LABEL[featured.type]}${featured.subject ? ` for ${featured.subject}` : ''}, ready to open offline.`) : 'Bring together learning sheets, games, tools and ideas. Nothing is uploaded — your library lives in this browser.'}</p>
        {featured && <div className="hero-meta"><span><FeaturedIcon size={13}/> {TYPE_LABEL[featured.type]}</span>{featured.subject && <span>{featured.subject}</span>}<span>{featured.lastOpenedAt ? `Opened ${friendlyDate(featured.lastOpenedAt)}` : bytes(featured.storageSize)}</span></div>}
        <div className="hero-actions">
          <button className="button hero-button" onClick={() => featured ? a.open(featured) : add()}>{featured ? <><Play size={15} fill="currentColor"/> {OPEN_VERB[featured.type]}</> : <><Upload size={16}/> Import your first project</>}</button>
          {featured ? <>
            <button className="button hero-ghost" onClick={() => a.favorite(featured)} aria-pressed={featured.favorite}><Heart size={16} fill={featured.favorite ? 'currentColor' : 'none'}/> {featured.favorite ? 'Favorited' : 'Favorite'}</button>
            <button className="button hero-ghost" onClick={() => a.details(featured)}>Details</button>
          </> : <button className="button hero-ghost" onClick={() => go('import')}>See what you can import</button>}
        </div>
      </div>
      {featured
        ? <div className="hero-art" aria-hidden="true"><div className="hero-cover-card" style={{ backgroundImage: art }} /></div>
        : <div className="hero-art" aria-hidden="true"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-core"><img src={`${base}icon-512.png`} alt="" /></div><span className="hero-spark">✦</span></div>}
    </section>

    {items.length < 3 && <section className="section-block"><div className="section-title-row"><div><h2>Get started</h2><p>A few useful ways to begin</p></div></div><div className="start-list">
      <button className="start-item" onClick={add}><span className="start-icon violet"><Upload size={18}/></span><span><b>Bring in a project</b><small>HTML, ZIP, PDF or a whole folder</small></span><ArrowRight size={16}/></button>
      <button className="start-item" onClick={() => go('learning')}><span className="start-icon mint"><BookOpen size={18}/></span><span><b>Make a learning space</b><small>Keep study material together by subject</small></span><ArrowRight size={16}/></button>
      <button className="start-item" onClick={() => go('studio')}><span className="start-icon peach"><Sparkles size={18}/></span><span><b>Prepare with AI studio</b><small>Turn HTML or a PDF into a ready project</small></span><ArrowRight size={16}/></button>
      {tryDemos && <button className="start-item" onClick={tryDemos}><span className="start-icon blue"><Gamepad2 size={18}/></span><span><b>Try the demo projects</b><small>8 working examples to explore — remove them any time in Settings</small></span><ArrowRight size={16}/></button>}
    </div></section>}

    <Shelf title="Continue where you left off" detail="Recently opened on this device" items={recent.slice(1)} limit={4} seeAll={{ onClick: () => go('recent') }} />
    <Shelf title="Favorites" detail="Kept close at hand" items={favorites} limit={4} seeAll={{ onClick: () => go('favorites') }} />
    <Shelf title="Recently added" items={added} limit={4} seeAll={{ onClick: () => go('library') }} />
    {collections.length > 0 && <section className="section-block"><div className="section-title-row"><div><h2>Collections</h2><p>Your own groups of projects</p></div><button className="text-button" onClick={() => go('collections')}>All collections <ArrowRight size={15}/></button></div>
      <div className="collection-grid">{collections.slice(0, 4).map(c => <CollectionTile key={c.id} collection={c} items={items} />)}</div></section>}
    <Shelf title="Learning materials" items={learning} limit={4} seeAll={{ label: 'Open Learning hub', onClick: () => go('learning') }} />
    <Shelf title="Games & apps" items={play} limit={4} seeAll={{ label: 'Open Games & apps', onClick: () => go('games') }} />

    <section className="section-block"><div className="section-title-row"><div><h2>Quick access</h2></div></div><div className="explore-row">
      <ExploreTile icon={Library} title="Everything" detail={`${items.length} item${items.length === 1 ? '' : 's'}`} color="violet" page="library" />
      <ExploreTile icon={BookOpen} title="Learning hub" detail={`${learning.length} material${learning.length === 1 ? '' : 's'}`} color="mint" page="learning" />
      <ExploreTile icon={Gamepad2} title="Games & apps" detail={`${play.length} to play and use`} color="peach" page="games" />
      <ExploreTile icon={Archive} title="Collections" detail={`${collections.length} organized`} color="blue" page="collections" />
    </div></section>
    <footer className="page-footer">Saved on this device <span>·</span> Works offline <span>·</span> Yours to keep</footer>
  </>;
}

function ExploreTile({ icon: Icon, title, detail, color, page }: { icon: LucideIcon; title: string; detail: string; color: string; page: Page }) {
  return <button className="explore-tile" onClick={() => go(page)}><span className={`start-icon ${color}`}><Icon size={17}/></span><span><b>{title}</b><small>{detail}</small></span></button>;
}

/* ---------- Library views ---------- */

const PAGE_META: Record<string, { title: string; description: string; icon: LucideIcon; empty: [string, string] }> = {
  library: { title: 'All items', description: 'Every project saved in this browser.', icon: Library, empty: ['Your library is ready for its first project', 'Import an HTML project, ZIP, PDF or folder. Everything stays on this device.'] },
  favorites: { title: 'Favorites', description: 'The projects you want to find quickly.', icon: Heart, empty: ['Nothing saved as a favorite yet', 'Tap the heart on any project to keep it here.'] },
  recent: { title: 'Recently opened', description: 'Pick up from the last thing you opened.', icon: Clock3, empty: ['Your recent projects will appear here', 'Open something from your library and it will be waiting for you.'] },
  learning: { title: 'Learning hub', description: 'Study sheets, interactive lessons, quizzes, PDFs and presentations — organized by subject.', icon: BookOpen, empty: ['Start your learning space', 'Import Lernzettel, quizzes or PDFs and give them a subject to see them here.'] },
  games: { title: 'Games & apps', description: 'Games, tools, simulations and small applications.', icon: Gamepad2, empty: ['Nothing to play yet', 'Import an HTML game, app or simulation to see it here.'] },
};

export function LibraryView({ page, items, query, setQuery, sort, setSort }: { page: 'library' | 'favorites' | 'recent' | 'learning' | 'games'; items: LibraryItem[]; query: string; setQuery: (v: string) => void; sort: ItemSort; setSort: (v: ItemSort) => void }) {
  const meta = PAGE_META[page]!;
  const [view, setViewState] = useState<View>(readView);
  const [type, setType] = useState<'all' | ContentType>('all');
  const [subject, setSubject] = useState('');
  useEffect(() => { setType('all'); setSubject(''); }, [page]);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };

  const scope = useMemo(() => {
    if (page === 'favorites') return items.filter(i => i.favorite);
    if (page === 'recent') return items.filter(i => i.lastOpenedAt);
    if (page === 'learning') return items.filter(i => LEARNING_TYPES.includes(i.type) || (i.type === 'other' && Boolean(i.subject)));
    if (page === 'games') return items.filter(i => PLAY_TYPES.includes(i.type));
    return items;
  }, [items, page]);
  const subjects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of scope) { const key = (page === 'games' ? i.genre || i.subject : i.subject).trim(); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  }, [scope, page]);
  const shown = useMemo(() => {
    let result = scope;
    if (type !== 'all') result = result.filter(i => i.type === type);
    if (subject) result = result.filter(i => (page === 'games' ? i.genre || i.subject : i.subject).trim() === subject);
    if (query.trim()) result = result.filter(i => matches(i, query.trim()));
    return [...result].sort(page === 'recent' ? byOpened : SORTERS[sort]);
  }, [scope, type, subject, query, sort, page]);

  const typeOptions = useMemo(() => {
    const allowed = page === 'learning' ? LEARNING_TYPES : page === 'games' ? PLAY_TYPES : (Object.keys(TYPE_LABEL) as ContentType[]);
    return [{ value: 'all' as const, label: 'All', count: scope.length }, ...allowed.map(t => ({ value: t, label: t === 'learning' ? (page === 'learning' ? 'Lernzettel' : 'Learning') : t === 'document' ? 'PDFs' : TYPE_LABEL[t] + (t === 'quiz' ? 'zes' : 's'), count: scope.filter(i => i.type === t).length, icon: TYPE_ICON[t] })).filter(o => o.count > 0)];
  }, [scope, page]);

  const filtering = type !== 'all' || Boolean(subject) || Boolean(query.trim());
  const showShelves = !filtering && (page === 'learning' || page === 'games') && scope.length > 12;

  return <>
    <PageHeading title={subject || meta.title} description={subject ? `${shown.length} item${shown.length === 1 ? '' : 's'} in ${subject}` : meta.description} action={<button className="button primary" onClick={() => go('import')}><Plus size={17}/> Import</button>} />
    {(page === 'learning' || page === 'games') && subjects.length > 0 && <section className="subject-strip" aria-label={page === 'games' ? 'Genres' : 'Subjects'}>
      {subjects.map(([name, count]) => { const color = colorFor(name); return <button key={name} className={`subject-tile ${subject === name ? 'active' : ''}`} style={{ '--tile': color } as React.CSSProperties} onClick={() => setSubject(subject === name ? '' : name)} aria-pressed={subject === name}>
        <span className="subject-initial">{name.slice(0, 1).toUpperCase()}</span><span><b>{name}</b><small>{count} item{count === 1 ? '' : 's'}</small></span></button>; })}
    </section>}
    {scope.length > 0 && <div className="library-toolbar">
      <label className="field-search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${meta.title.toLowerCase()}…`} aria-label={`Search ${meta.title}`}/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></button>}</label>
      {page !== 'recent' && <label className="select-wrap"><ListFilter size={15}/><select aria-label="Sort projects" value={sort} onChange={e => setSort(e.target.value as ItemSort)}><option value="imported">Recently added</option><option value="opened">Last opened</option><option value="name">Name</option><option value="size">File size</option><option value="modified">Recently modified</option></select></label>}
      {page !== 'recent' && <div className="segmented" role="radiogroup" aria-label="Layout"><button role="radio" aria-checked={view === 'grid'} className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view"><LayoutGrid size={16}/></button><button role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view"><List size={16}/></button></div>}
    </div>}
    {scope.length > 0 && typeOptions.length > 2 && <Chips label="Filter by type" options={typeOptions} value={type} onChange={setType} />}

    {!scope.length ? <EmptyState icon={meta.icon} title={meta.empty[0]} detail={meta.empty[1]} action={page === 'favorites' || page === 'recent' ? <button className="button primary" onClick={() => go('library')}><Library size={16}/> Browse library</button> : <button className="button primary" onClick={() => go('import')}><Plus size={16}/> Import a project</button>} />
      : !shown.length ? <EmptyState icon={Search} title="No matches" detail="Try a different title, subject or tag, or clear the filters." action={<button className="button" onClick={() => { setQuery(''); setType('all'); setSubject(''); }}>Clear filters</button>} />
      : page === 'recent' ? <RecentList items={shown} />
      : showShelves ? <div className="shelves">{(page === 'learning' ? LEARNING_TYPES : PLAY_TYPES).map(t => <Shelf key={t} title={typeOptions.find(o => o.value === t)?.label ?? TYPE_LABEL[t]} items={shown.filter(i => i.type === t)} limit={8} seeAll={{ onClick: () => setType(t) }} />)}{page === 'learning' && <Shelf title="Other study material" items={shown.filter(i => i.type === 'other')} />}</div>
      : view === 'list' ? <div className="item-list">{shown.map(item => <ItemRow key={item.id} item={item} />)}</div>
      : <div className="item-grid">{shown.map((item, index) => <ItemCard key={item.id} item={item} index={index} />)}</div>}
  </>;
}

function RecentList({ items }: { items: LibraryItem[] }) {
  const groups = new Map<string, LibraryItem[]>();
  for (const item of items) { const key = dayGroup(item.lastOpenedAt!); groups.set(key, [...(groups.get(key) ?? []), item]); }
  return <div className="recent-groups">{[...groups.entries()].map(([label, list]) => <section key={label} className="recent-group"><h2>{label}</h2><div className="item-list">{list.map(item => <ItemRow key={item.id} item={item} meta={<>{timeOf(item.lastOpenedAt!)}<i>·</i>{item.openCount} open{item.openCount === 1 ? '' : 's'}</>} />)}</div></section>)}</div>;
}

/* ---------- Collections ---------- */

export function CollectionTile({ collection, items }: { collection: Collection; items: LibraryItem[] }) {
  const members = collection.orderedItemIds.map(id => items.find(i => i.id === id)).filter((i): i is LibraryItem => Boolean(i));
  const covers = members.slice(0, 4);
  return <button className="collection-tile" onClick={() => go('collections', `?collection=${encodeURIComponent(collection.id)}`)}>
    <span className={`collection-mosaic count-${Math.max(1, covers.length)}`} style={{ '--tile': collection.accentColor } as React.CSSProperties}>
      {covers.length ? covers.map(i => <span key={i.id} style={{ backgroundImage: coverBackground(i) }} />) : <span className="mosaic-empty"><Archive size={26}/></span>}
    </span>
    <span className="collection-tile-copy"><b>{collection.name}</b><small>{collection.description || `${members.length} project${members.length === 1 ? '' : 's'}`}</small></span>
  </button>;
}

export function CollectionsPage({ collections, items, add, remove }: { collections: Collection[]; items: LibraryItem[]; add: () => void; remove: (c: Collection) => void }) {
  return <>
    <PageHeading title="Collections" description="Group projects around a subject, a class, or anything that belongs together." action={<button className="button primary" onClick={add}><FolderPlus size={17}/> New collection</button>} />
    {collections.length ? <div className="collection-grid">{collections.map(c => <div className="collection-tile-wrap" key={c.id}><CollectionTile collection={c} items={items} /><button className="icon-button collection-delete" aria-label={`Delete ${c.name}`} onClick={() => remove(c)}><X size={16}/></button></div>)}
      <button className="collection-new" onClick={add}><Plus size={22}/><b>New collection</b></button></div>
      : <EmptyState icon={Archive} title="Make a collection of your own" detail="Keep projects together by class, topic, or whatever makes sense to you. A project can live in several collections." action={<button className="button primary" onClick={add}><Plus size={16}/> New collection</button>} />}
  </>;
}

/* ---------- Project details ---------- */

export function ItemDetailsPage({ item, collections }: { item: LibraryItem | undefined; collections: Collection[] }) {
  const a = useItemActions();
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [timeSpent, setTimeSpent] = useState(0);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!item) return;
    let active = true;
    void getAssets(item.id).then(rows => { if (active) setAssets(rows); }).catch(() => { if (active) setAssets([]); });
    void db.usage.where('itemId').equals(item.id).toArray().then(rows => { if (active) setTimeSpent(rows.reduce((sum, r) => sum + (r.durationMs ?? 0), 0)); }).catch(() => undefined);
    return () => { active = false; };
  }, [item?.id, item?.updatedAt]);
  if (!item) return <EmptyState icon={Library} title="This project isn’t in your library" detail="It may have been removed from this browser." action={<button className="button" onClick={() => go('library')}><ArrowLeft size={15}/> Back to library</button>} />;
  const Icon = TYPE_ICON[item.type];
  const art = coverBackground(item);
  const memberOf = collections.filter(c => item.collectionIds.includes(c.id));
  const minutes = Math.round(timeSpent / 60_000);
  const info: Array<[string, React.ReactNode]> = [
    ['Type', TYPE_LABEL[item.type]],
    ...(item.subject ? [['Subject', item.subject] as [string, string]] : []),
    ...(item.topic ? [['Topic', item.topic] as [string, string]] : []),
    ...(item.genre ? [['Genre', item.genre] as [string, string]] : []),
    ['Size', `${bytes(item.storageSize)} · ${item.fileCount} file${item.fileCount === 1 ? '' : 's'}`],
    ['Entry page', <code key="e">{item.entryFile}</code>],
    ['Imported', friendlyDate(item.importedAt)],
    ['Last opened', friendlyDate(item.lastOpenedAt)],
    ['Opened', `${item.openCount} time${item.openCount === 1 ? '' : 's'}`],
    ...(timeSpent ? [['Time spent', minutes < 1 ? 'Under a minute' : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`] as [string, string]] : []),
    ['Source file', item.originalFilename],
  ];
  const score = item.offlineCompatibility.score;
  return <div className="details-page">
    <button className="text-button back-link" onClick={() => history.length > 1 ? history.back() : go('library')}><ArrowLeft size={15}/> Back</button>
    <section className="details-hero">
      <span className="details-bg" aria-hidden="true"><span className="hero-backdrop" style={{ backgroundImage: art }} /></span>
      <button className="details-cover" style={{ backgroundImage: art }} onClick={() => a.open(item)} aria-label={`${OPEN_VERB[item.type]} ${item.title}`}><span className="cover-play"><Play size={18} fill="currentColor"/></span></button>
      <div className="details-copy">
        <span className="details-type"><Icon size={14}/> {itemSubtitle(item)}</span>
        <h1>{item.title}</h1>
        {item.description && <p>{item.description}</p>}
        <div className="details-actions">
          <button className="button hero-button" onClick={() => a.open(item)}><Play size={15} fill="currentColor"/> {OPEN_VERB[item.type]}</button>
          <button className="button hero-ghost" onClick={() => a.favorite(item)} aria-pressed={item.favorite}><Heart size={16} fill={item.favorite ? 'currentColor' : 'none'}/> {item.favorite ? 'Favorited' : 'Favorite'}</button>
          <button className="button hero-ghost" onClick={() => a.edit(item)}><Pencil size={15}/> Edit</button>
          <button className="button hero-ghost" onClick={() => a.share(item)}><Share2 size={15}/> Share</button>
          <span className="details-more"><button className="button hero-ghost icon-only" onClick={() => setMenu(v => !v)} aria-expanded={menu} aria-label="More actions"><MoreHorizontal size={18}/></button>{menu && <ItemMenu item={item} onClose={() => setMenu(false)} />}</span>
        </div>
      </div>
    </section>
    <div className="details-grid">
      <div className="details-main">
        <section className="panel">
          <h2>About</h2>
          <p className="details-description">{item.description || 'No description yet. Add one so this project is easier to find in search.'}</p>
          {item.tags.length > 0 && <div className="tag-list">{item.tags.map(t => <span key={t} className="tag">#{t}</span>)}</div>}
          {!item.description && <button className="text-button" onClick={() => a.edit(item)}><Pencil size={14}/> Add a description</button>}
        </section>
        <section className="panel">
          <div className="panel-title-row"><h2>Compatibility</h2><span className={`status-pill ${score}`}><ShieldCheck size={14}/>{score === 'likely' ? 'Likely works offline' : score === 'partial' ? 'Needs a look' : 'Not checked'}</span></div>
          <ul className="finding-list">{item.offlineCompatibility.findings.map(f => <li key={f}>{f}</li>)}</ul>
        </section>
        <section className="panel">
          <div className="panel-title-row"><h2>Files</h2><span className="muted-text">{item.fileCount} file{item.fileCount === 1 ? '' : 's'} · {bytes(item.storageSize)}</span></div>
          {assets === null ? <p className="muted-text">Reading files…</p> : <div className="file-list">{assets.slice(0, 60).map(f => <div key={f.id} className="file-row"><FileText size={15}/><span>{f.normalizedPath}</span>{f.normalizedPath === item.entryFile && <em>Entry</em>}<small>{bytes(f.fileSize)}</small></div>)}{assets.length > 60 && <p className="muted-text">…and {assets.length - 60} more</p>}</div>}
          {isHtmlItem(item) && <button className="button subtle" onClick={() => a.editCode(item)}><Code2 size={15}/> Edit HTML code</button>}
        </section>
      </div>
      <aside className="details-side">
        <section className="panel"><h2>Information</h2><dl className="info-list">{info.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
        <section className="panel"><div className="panel-title-row"><h2>Collections</h2><button className="text-button" onClick={() => a.collect(item)}><Plus size={14}/> Add</button></div>
          {memberOf.length ? <div className="tag-list">{memberOf.map(c => <button key={c.id} className="tag tag-link" style={{ '--tile': c.accentColor } as React.CSSProperties} onClick={() => go('collections', `?collection=${encodeURIComponent(c.id)}`)}>{c.name}</button>)}</div> : <p className="muted-text">Not in a collection yet.</p>}
        </section>
        <section className="panel details-tools"><h2>Manage</h2>
          <button className="button" onClick={() => a.exportOne(item)}>Export as ZIP</button>
          <button className="button" onClick={() => a.duplicate(item)}>Make a copy</button>
          <button className="button danger-button" onClick={() => a.remove(item)}>Remove from library</button>
        </section>
      </aside>
    </div>
  </div>;
}

