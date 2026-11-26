/* LocalDeck browsing screens: home, library views, collections and project details. */
import { language, plural, t, tm } from './i18n';
import React, { useEffect, useMemo, useState } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import {
  Archive, ArrowLeft, ArrowRight, BookOpen, Camera, Clock3, Code2, FileText, FolderPlus, Gamepad2, Heart, LayoutGrid,
  Library, List, ListFilter, MoreHorizontal, Pencil, Play, Plus, Search, Share2, ShieldCheck, Sparkles, Upload, X,
  type LucideIcon,
} from 'lucide-react';
import { db } from './services/database';
import { HeroLogo } from './heroLogo';
import { useProfile } from './profile';
import { tagsWithMark, useContentMarks } from './contentMarks';
import { ContentNote } from './contentNote';
import { ProjectRuntime } from './projectRuntime';
import { ProjectScanPanel } from './projectScanPanel';
import { rovingKeys, useStillMotion } from './a11y';
import { getAssets, hasPhotoCover, type ItemSort } from './services/library';
import type { Collection, ContentType, LibraryAsset, LibraryItem } from './types';
import {
  Chips, CountUp, EmptyState, ItemCard, ItemMenu, ItemRow, LEARNING_TYPES, OPEN_VERB, PLAY_TYPES, PageHeading, Shelf, TYPE_ICON, TYPE_LABEL, TYPE_PLURAL,
  bytes, colorFor, coverBackground, friendlyDate, go, isHtmlItem, itemSubtitle, matchesQuery, useItemActions, type Page,
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

function dayGroup(ts: number): string {
  const day = new Date(ts); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff <= 0) return t('Today');
  if (diff === 1) return t('Yesterday');
  if (diff < 7) return t('Earlier this week');
  if (diff < 31) return t('Earlier this month');
  return new Intl.DateTimeFormat(language(), { month: 'long', year: 'numeric' }).format(ts);
}
const timeOf = (ts: number) => new Intl.DateTimeFormat(language(), { hour: '2-digit', minute: '2-digit' }).format(ts);

/* ---------- Home ---------- */

export function HomePage({ items, collections, add, tryDemos }: { items: LibraryItem[]; collections: Collection[]; add: () => void; tryDemos?: () => void }) {
  const a = useItemActions();
  const recent = useMemo(() => items.filter(item => item.lastOpenedAt).sort(byOpened), [items]);
  const featured = recent[0] ?? items.find(item => item.favorite) ?? [...items].sort(byImported)[0];
  const hour = new Date().getHours();
  const { name } = useProfile();
  const greeting = `${hour < 5 ? t('Good night') : hour < 12 ? t('Good morning') : hour < 18 ? t('Good afternoon') : t('Good evening')}${name ? `, ${name}` : ''}.`;
  const art = featured ? coverBackground(featured) : '';
  const FeaturedIcon = featured ? TYPE_ICON[featured.type] : Sparkles;
  const still = useStillMotion();
  const { scrollY } = useScroll();
  const heroCopyY = useTransform(scrollY, [0, 420], [0, -36]);
  const heroCopyFade = useTransform(scrollY, [0, 380], [1, .35]);
  const heroCardY = useTransform(scrollY, [0, 420], [0, 46]);
  const favorites = items.filter(item => item.favorite);
  const added = [...items].sort(byImported);
  const learning = items.filter(item => LEARNING_TYPES.includes(item.type)).sort(byImported);
  const play = items.filter(item => PLAY_TYPES.includes(item.type)).sort(byImported);
  return <>
    <PageHeading title={greeting} description={items.length ? plural(items.length, '{0} project in your library, saved on this device.', '{0} projects in your library, saved on this device.', items.length) : t('Everything you learn, make and love, saved on this device.')}
      action={<><button className="button" onClick={() => go('studio')}><Sparkles size={16}/> {t('AI studio')}</button><button className="button primary" onClick={add}><Plus size={17}/> {t('Import')}</button></>} />
    <section className={`hero-banner beam spotlight ${featured ? 'has-art' : ''}`}>
      {!featured && <span className="aurora" aria-hidden="true"><i/><i/><i/></span>}
      {featured && <span className="hero-backdrop" style={{ backgroundImage: art }} aria-hidden="true" />}
      <motion.div className="hero-copy" style={still ? { y: 0, opacity: 1 } : { y: heroCopyY, opacity: heroCopyFade }}>
        <div className="hero-kicker"><i /> {featured ? (featured.lastOpenedAt ? t('Continue where you left off') : featured.favorite ? t('One of your favorites') : t('Recently added')) : t('Private by design')}</div>
        <h2>{featured ? featured.title : t('Your world, all in one place.')}</h2>
        <p>{featured ? (featured.description || (featured.subject ? t('{0} for {1}, ready to open offline.', TYPE_LABEL[featured.type], featured.subject) : t('{0}, ready to open offline.', TYPE_LABEL[featured.type]))) : t('Bring together learning sheets, games, tools and ideas. Nothing is uploaded: your library lives in this browser.')}</p>
        {featured && <div className="hero-meta"><span><FeaturedIcon size={13}/> {TYPE_LABEL[featured.type]}</span>{featured.subject && <span>{featured.subject}</span>}<span>{featured.lastOpenedAt ? t('Opened {0}', friendlyDate(featured.lastOpenedAt)) : bytes(featured.storageSize)}</span></div>}
        <div className="hero-actions">
          <button className="button hero-button" onClick={() => featured ? a.open(featured) : add()}>{featured ? <><Play size={15} fill="currentColor"/> {OPEN_VERB[featured.type]}</> : <><Upload size={16}/> {t('Import your first project')}</>}</button>
          {featured ? <>
            <button className="button hero-ghost" onClick={() => a.favorite(featured)} aria-pressed={featured.favorite}><Heart size={16} fill={featured.favorite ? 'currentColor' : 'none'}/> {featured.favorite ? t('Favorited') : t('Favorite')}</button>
            <button className="button hero-ghost" onClick={() => a.details(featured)}>{t('Details')}</button>
          </> : <button className="button hero-ghost" onClick={() => go('import')}>{t('See what you can import')}</button>}
        </div>
      </motion.div>
      {featured
        ? <div className="hero-art" aria-hidden="true"><motion.div className="hero-cover-card" style={{ backgroundImage: art, y: still ? 0 : heroCardY, rotate: -3 }} whileHover={{ rotate: -1, scale: 1.04 }} transition={{ type: 'spring', bounce: .3 }} /></div>
        : <HeroLogo/>}
    </section>

    {items.length < 3 && <section className="section-block"><div className="section-title-row"><div><h2>{t('Get started')}</h2><p>{t('A few useful ways to begin')}</p></div></div><div className="start-list">
      <button className="start-item" onClick={add}><span className="start-icon violet"><Upload size={18}/></span><span><b>{t('Bring in a project')}</b><small>{t('HTML, ZIP, PDF or a whole folder')}</small></span><ArrowRight size={16}/></button>
      <button className="start-item" onClick={() => go('learning')}><span className="start-icon mint"><BookOpen size={18}/></span><span><b>{t('Make a learning space')}</b><small>{t('Keep study material together by subject')}</small></span><ArrowRight size={16}/></button>
      <button className="start-item" onClick={() => go('studio')}><span className="start-icon peach"><Sparkles size={18}/></span><span><b>{t('Prepare with AI studio')}</b><small>{t('Turn HTML or a PDF into a ready project')}</small></span><ArrowRight size={16}/></button>
      {tryDemos && <button className="start-item" onClick={tryDemos}><span className="start-icon blue"><Gamepad2 size={18}/></span><span><b>{t('Try the demo projects')}</b><small>{t('8 working examples. Remove them any time in Settings.')}</small></span><ArrowRight size={16}/></button>}
    </div></section>}

    <Shelf title={t('Continue where you left off')} detail={t('Recently opened on this device')} items={recent.slice(1)} limit={4} seeAll={{ onClick: () => go('recent') }} />
    <Shelf title={t('Favorites')} detail={t('Kept close at hand')} items={favorites} limit={4} seeAll={{ onClick: () => go('favorites') }} />
    <Shelf title={t('Recently added')} items={added} limit={4} seeAll={{ onClick: () => go('library') }} />
    {collections.length > 0 && <section className="section-block"><div className="section-title-row"><div><h2>{t('Collections')}</h2><p>{t('Your own groups of projects')}</p></div><button className="text-button" onClick={() => go('collections')}>{t('All collections')} <ArrowRight size={15}/></button></div>
      <div className="collection-grid">{collections.slice(0, 4).map(c => <CollectionTile key={c.id} collection={c} items={items} />)}</div></section>}
    <Shelf title={t('Learning materials')} items={learning} limit={4} seeAll={{ label: t('Open Learning hub'), onClick: () => go('learning') }} />
    <Shelf title={t('Games & apps')} items={play} limit={4} seeAll={{ label: t('Open Games & apps'), onClick: () => go('games') }} />

    <section className="section-block"><div className="section-title-row"><div><h2>{t('Quick access')}</h2></div></div><div className="explore-row">
      <ExploreTile icon={Library} title={t('Everything')} detail={<><CountUp value={items.length}/> {plural(items.length, 'item', 'items')}</>} color="violet" page="library" />
      <ExploreTile icon={BookOpen} title={t('Learning hub')} detail={<><CountUp value={learning.length}/> {plural(learning.length, 'material', 'materials')}</>} color="mint" page="learning" />
      <ExploreTile icon={Gamepad2} title={t('Games & apps')} detail={<><CountUp value={play.length}/> {t('to play and use')}</>} color="peach" page="games" />
      <ExploreTile icon={Archive} title={t('Collections')} detail={<><CountUp value={collections.length}/> {t('organized')}</>} color="blue" page="collections" />
    </div></section>
    <footer className="page-footer">{t('Saved on this device')} <span>·</span> {t('Works offline')} <span>·</span> {t('Yours to keep')}</footer>
  </>;
}

function ExploreTile({ icon: Icon, title, detail, color, page }: { icon: LucideIcon; title: string; detail: React.ReactNode; color: string; page: Page }) {
  return <button className="explore-tile spotlight" onClick={() => go(page)}><span className={`start-icon ${color}`}><Icon size={17}/></span><span><b>{title}</b><small>{detail}</small></span></button>;
}

/* ---------- Library views ---------- */

const PAGE_META: Record<string, { title: string; description: string; icon: LucideIcon; empty: [string, string] }> = {
  library: { title: t('All items'), description: t('Every project saved in this browser.'), icon: Library, empty: [t('Your library is ready for its first project'), t('Import an HTML project, ZIP, PDF or folder. Everything stays on this device.')] },
  favorites: { title: t('Favorites'), description: t('The projects you want to find quickly.'), icon: Heart, empty: [t('Nothing saved as a favorite yet'), t('Tap the heart on any project to keep it here.')] },
  recent: { title: t('Recently opened'), description: t('Pick up from the last thing you opened.'), icon: Clock3, empty: [t('Your recent projects will appear here'), t('Open something from your library and it will be waiting for you.')] },
  learning: { title: t('Learning hub'), description: t('Study sheets, interactive lessons, quizzes, PDFs and presentations, organized by subject.'), icon: BookOpen, empty: [t('Start your learning space'), t('Import study sheets, quizzes or PDFs and give them a subject to see them here.')] },
  games: { title: t('Games & apps'), description: t('Games, tools, simulations and small applications.'), icon: Gamepad2, empty: [t('Nothing to play yet'), t('Import an HTML game, app or simulation to see it here.')] },
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
    if (query.trim()) result = result.filter(i => matchesQuery(i, query));
    return [...result].sort(page === 'recent' ? byOpened : SORTERS[sort]);
  }, [scope, type, subject, query, sort, page]);

  const typeOptions = useMemo(() => {
    const allowed = page === 'learning' ? LEARNING_TYPES : page === 'games' ? PLAY_TYPES : (Object.keys(TYPE_LABEL) as ContentType[]);
    return [{ value: 'all' as const, label: t('All'), count: scope.length }, ...allowed.map(kind => ({ value: kind, label: kind === 'learning' ? (page === 'learning' ? t('Study sheets') : t('Learning')) : TYPE_PLURAL[kind], count: scope.filter(i => i.type === kind).length, icon: TYPE_ICON[kind] })).filter(o => o.count > 0)];
  }, [scope, page]);

  const filtering = type !== 'all' || Boolean(subject) || Boolean(query.trim());
  const showShelves = !filtering && (page === 'learning' || page === 'games') && scope.length > 12;

  return <>
    <PageHeading title={subject || meta.title} description={subject ? plural(shown.length, '{0} item in {1}', '{0} items in {1}', shown.length, subject) : meta.description} action={<button className="button primary" onClick={() => go('import')}><Plus size={17}/> {t('Import')}</button>} />
    {(page === 'learning' || page === 'games') && subjects.length > 0 && <section className="subject-strip" aria-label={page === 'games' ? t('Genres') : t('Subjects')}>
      {subjects.map(([name, count]) => { const color = colorFor(name); return <button key={name} className={`subject-tile ${subject === name ? 'active' : ''}`} style={{ '--tile': color } as React.CSSProperties} onClick={() => setSubject(subject === name ? '' : name)} aria-pressed={subject === name}>
        <span className="subject-initial">{name.slice(0, 1).toUpperCase()}</span><span><b>{name}</b><small>{plural(count, '{0} item', '{0} items', count)}</small></span></button>; })}
    </section>}
    {scope.length > 0 && <div className="library-toolbar">
      <label className="field-search"><Search size={16} aria-hidden="true"/><span className="field-label">{t('Search')}</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Title, subject or tag')}/>{query && <button aria-label={t('Clear search')} onClick={() => setQuery('')}><X size={15}/></button>}</label>
      {page !== 'recent' && <label className="select-wrap"><ListFilter size={15}/><select aria-label={t('Sort projects')} value={sort} onChange={e => setSort(e.target.value as ItemSort)}><option value="imported">{t('Recently added')}</option><option value="opened">{t('Last opened')}</option><option value="name">{t('Name')}</option><option value="size">{t('File size')}</option><option value="modified">{t('Recently modified')}</option></select></label>}
      {page !== 'recent' && <div className="segmented" role="radiogroup" aria-label={t('Layout')} onKeyDown={event => rovingKeys(event, '[role="radio"]', true)}><button role="radio" aria-checked={view === 'grid'} tabIndex={view === 'grid' ? 0 : -1} className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label={t('Grid view')}><LayoutGrid size={16}/></button><button role="radio" aria-checked={view === 'list'} tabIndex={view === 'list' ? 0 : -1} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label={t('List view')}><List size={16}/></button></div>}
    </div>}
    {scope.length > 0 && typeOptions.length > 2 && <Chips label={t('Filter by type')} options={typeOptions} value={type} onChange={setType} />}

    {!scope.length ? <EmptyState icon={meta.icon} title={meta.empty[0]} detail={meta.empty[1]} action={page === 'favorites' || page === 'recent' ? <button className="button primary" onClick={() => go('library')}><Library size={16}/> {t('Browse library')}</button> : <button className="button primary" onClick={() => go('import')}><Plus size={16}/> {t('Import a project')}</button>} />
      : !shown.length ? <EmptyState icon={Search} title={t('No matches')} detail={t('Try a different title, subject or tag, or clear the filters.')} action={<button className="button" onClick={() => { setQuery(''); setType('all'); setSubject(''); }}>{t('Clear filters')}</button>} />
      : page === 'recent' ? <RecentList items={shown} />
      : showShelves ? <div className="shelves">{(page === 'learning' ? LEARNING_TYPES : PLAY_TYPES).map(kind => <Shelf key={kind} title={typeOptions.find(o => o.value === kind)?.label ?? TYPE_LABEL[kind]} items={shown.filter(i => i.type === kind)} limit={8} seeAll={{ onClick: () => setType(kind) }} />)}{page === 'learning' && <Shelf title={t('Other study material')} items={shown.filter(i => i.type === 'other')} />}</div>
      : view === 'list' ? <div className="item-list">{shown.map(item => <ItemRow key={item.id} item={item} />)}</div>
      : <div className="item-grid">{shown.map((item, index) => <ItemCard key={item.id} item={item} index={index} />)}</div>}
  </>;
}

function RecentList({ items }: { items: LibraryItem[] }) {
  const groups = new Map<string, LibraryItem[]>();
  for (const item of items) { const key = dayGroup(item.lastOpenedAt!); groups.set(key, [...(groups.get(key) ?? []), item]); }
  return <div className="recent-groups">{[...groups.entries()].map(([label, list]) => <section key={label} className="recent-group"><h2>{label}</h2><div className="item-list">{list.map(item => <ItemRow key={item.id} item={item} meta={<>{timeOf(item.lastOpenedAt!)}<i>·</i>{plural(item.openCount, '{0} open', '{0} opens', item.openCount)}</>} />)}</div></section>)}</div>;
}

/* ---------- Collections ---------- */

export function CollectionTile({ collection, items }: { collection: Collection; items: LibraryItem[] }) {
  const members = collection.orderedItemIds.map(id => items.find(i => i.id === id)).filter((i): i is LibraryItem => Boolean(i));
  const covers = members.slice(0, 4);
  return <button className="collection-tile" onClick={() => go('collections', `?collection=${encodeURIComponent(collection.id)}`)}>
    <span className={`collection-mosaic count-${Math.max(1, covers.length)}`} style={{ '--tile': collection.accentColor } as React.CSSProperties}>
      {covers.length ? covers.map(i => <span key={i.id} style={{ backgroundImage: coverBackground(i) }} />) : <span className="mosaic-empty"><Archive size={26}/></span>}
    </span>
    <span className="collection-tile-copy"><b>{collection.name}</b><small>{collection.description || plural(members.length, '{0} project', '{0} projects', members.length)}</small></span>
  </button>;
}

export function CollectionsPage({ collections, items, add, remove }: { collections: Collection[]; items: LibraryItem[]; add: () => void; remove: (c: Collection) => void }) {
  return <>
    <PageHeading title={t('Collections')} description={t('Group projects around a subject, a class, or anything that belongs together.')} action={<button className="button primary" onClick={add}><FolderPlus size={17}/> {t('New collection')}</button>} />
    {collections.length ? <div className="collection-grid">{collections.map(c => <div className="collection-tile-wrap" key={c.id}><CollectionTile collection={c} items={items} /><button className="icon-button collection-delete" aria-label={t('Delete {0}', c.name)} onClick={() => remove(c)}><X size={16}/></button></div>)}
      <button className="collection-new" onClick={add}><Plus size={22}/><b>{t('New collection')}</b></button></div>
      : <EmptyState icon={Archive} title={t('Make a collection of your own')} detail={t('Keep projects together by class, topic, or whatever makes sense to you. A project can live in several collections.')} action={<button className="button primary" onClick={add}><Plus size={16}/> {t('New collection')}</button>} />}
  </>;
}

/* ---------- Project details ---------- */

export function ItemDetailsPage({ item, collections }: { item: LibraryItem | undefined; collections: Collection[] }) {
  const a = useItemActions();
  const { on: marks } = useContentMarks();
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
  if (!item) return <EmptyState icon={Library} title={t('This project isn’t in your library')} detail={t('It may have been removed from this browser.')} action={<button className="button" onClick={() => go('library')}><ArrowLeft size={15}/> {t('Back to library')}</button>} />;
  const Icon = TYPE_ICON[item.type];
  const tags = tagsWithMark(item.tags, item.contentCheck, marks);
  const art = coverBackground(item);
  const memberOf = collections.filter(c => item.collectionIds.includes(c.id));
  const minutes = Math.round(timeSpent / 60_000);
  const info: Array<[string, React.ReactNode]> = [
    [t('Type'), TYPE_LABEL[item.type]],
    ...(item.subject ? [[t('Subject'), item.subject] as [string, string]] : []),
    ...(item.topic ? [[t('Topic'), item.topic] as [string, string]] : []),
    ...(item.genre ? [[t('Genre'), item.genre] as [string, string]] : []),
    [t('Size'), plural(item.fileCount, '{0} · {1} file', '{0} · {1} files', bytes(item.storageSize), item.fileCount)],
    [t('Entry page'), <code key="e">{item.entryFile}</code>],
    [t('Imported'), friendlyDate(item.importedAt)],
    [t('Last opened'), friendlyDate(item.lastOpenedAt)],
    [t('Opened'), plural(item.openCount, '{0} time', '{0} times', item.openCount)],
    ...(timeSpent ? [[t('Time spent'), minutes < 1 ? t('Under a minute') : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`] as [string, string]] : []),
    [t('Source file'), item.originalFilename],
  ];
  const score = item.offlineCompatibility.score;
  return <div className="details-page">
    <button className="text-button back-link" onClick={() => history.length > 1 ? history.back() : go('library')}><ArrowLeft size={15}/> {t('Back')}</button>
    <section className="details-hero">
      <span className="details-bg" aria-hidden="true"><span className="hero-backdrop" style={{ backgroundImage: art }} /></span>
      <button className="details-cover" style={{ backgroundImage: art }} onClick={() => a.open(item)} aria-label={`${OPEN_VERB[item.type]} ${item.title}`}><span className="cover-play"><Play size={18} fill="currentColor"/></span></button>
      <div className="details-copy">
        <span className="details-type"><Icon size={14}/> {itemSubtitle(item)}</span>
        <h1>{item.title}</h1>
        {item.description && <p>{item.description}</p>}
        <div className="details-actions">
          <button className="button hero-button" onClick={() => a.open(item)}><Play size={15} fill="currentColor"/> {OPEN_VERB[item.type]}</button>
          <button className="button hero-ghost" onClick={() => a.favorite(item)} aria-pressed={item.favorite}><Heart size={16} fill={item.favorite ? 'currentColor' : 'none'}/> {item.favorite ? t('Favorited') : t('Favorite')}</button>
          <button className="button hero-ghost" onClick={() => a.edit(item)}><Pencil size={15}/> {t('Edit')}</button>
          <button className="button hero-ghost" onClick={() => a.share(item)}><Share2 size={15}/> {t('Share')}</button>
          <span className="details-more"><button className="button hero-ghost icon-only" onClick={() => setMenu(v => !v)} aria-expanded={menu} aria-label={t('More actions')}><MoreHorizontal size={18}/></button>{menu && <ItemMenu item={item} onClose={() => setMenu(false)} />}</span>
        </div>
      </div>
    </section>
    <div className="details-grid">
      <div className="details-main">
        <section className="panel">
          <h2>{t('About')}</h2>
          <p className="details-description">{item.description || t('No description yet. Add one so this project is easier to find in search.')}</p>
          {tags.length > 0 && <div className="tag-list">{tags.map(tag => <button key={tag} type="button" className={`tag tag-link ${tag === '18+' ? 'tag-18' : tag === '16+' ? 'tag-16' : ''}`} title={t('Show projects with #{0}', tag)} onClick={() => a.showTag(tag)}>#{tag}</button>)}</div>}
          {!item.description && <button className="text-button" onClick={() => a.edit(item)}><Pencil size={14}/> {t('Add a description')}</button>}
          {item.contentCheck && <ContentNote check={item.contentCheck}>{item.contentCheck.rating !== 'ok' && !item.contentCheck.confirmed && <button type="button" className="text-button" onClick={() => a.confirmContent(item)}>{t('This is fine')}</button>}</ContentNote>}
        </section>
        {isHtmlItem(item) && <ProjectScanPanel key={item.id} item={item}/>}
        <section className="panel">
          <div className="panel-title-row"><h2>{t('Compatibility')}</h2><span className={`status-pill ${score}`}><ShieldCheck size={14}/>{score === 'likely' ? t('Likely works offline') : score === 'partial' ? t('Needs a look') : t('Not checked')}</span></div>
          <ul className="finding-list">{item.offlineCompatibility.findings.map(f => <li key={f}>{tm(f)}</li>)}</ul>
          {isHtmlItem(item) && <ProjectRuntime item={item}/>}
        </section>
        <section className="panel">
          <div className="panel-title-row"><h2>{t('Files')}</h2><span className="muted-text">{plural(item.fileCount, '{0} file · {1}', '{0} files · {1}', item.fileCount, bytes(item.storageSize))}</span></div>
          {assets === null ? <p className="muted-text">{t('Reading files…')}</p> : <div className="file-list">{assets.slice(0, 60).map(f => <div key={f.id} className="file-row"><FileText size={15}/><span>{f.normalizedPath}</span>{f.normalizedPath === item.entryFile && <em>{t('Entry')}</em>}<small>{bytes(f.fileSize)}</small></div>)}{assets.length > 60 && <p className="muted-text">{t('…and {0} more', assets.length - 60)}</p>}</div>}
          {isHtmlItem(item) && <button className="button subtle" onClick={() => a.editCode(item)}><Code2 size={15}/> {t('Edit HTML code')}</button>}
        </section>
      </div>
      <aside className="details-side">
        <section className="panel"><h2>{t('Information')}</h2><dl className="info-list">{info.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
        <section className="panel"><div className="panel-title-row"><h2>{t('Collections')}</h2><button className="text-button" onClick={() => a.collect(item)}><Plus size={14}/> {t('Add')}</button></div>
          {memberOf.length ? <div className="tag-list">{memberOf.map(c => <button key={c.id} className="tag tag-link" style={{ '--tile': c.accentColor } as React.CSSProperties} onClick={() => go('collections', `?collection=${encodeURIComponent(c.id)}`)}>{c.name}</button>)}</div> : <p className="muted-text">{t('Not in a collection yet.')}</p>}
        </section>
        <section className="panel details-tools"><h2>{t('Manage')}</h2>
          {isHtmlItem(item) && <button className="button" onClick={() => a.takeCover(item)}><Camera size={15}/> {t('Photo of the project as cover')}</button>}
          {hasPhotoCover(item) && <button className="button" onClick={() => a.dropCover(item)}>{t('Remove the photo')}</button>}
          <button className="button" onClick={() => a.exportOne(item)}>{t('Export as ZIP')}</button>
          <button className="button" onClick={() => a.duplicate(item)}>{t('Make a copy')}</button>
          <button className="button danger-button" onClick={() => a.remove(item)}>{t('Remove from library')}</button>
        </section>
      </aside>
    </div>
  </div>;
}

