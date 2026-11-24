/* Shared building blocks used across LocalDeck screens. */
import { language, plural, t } from './i18n';
import { createPortal } from 'react-dom';
import React, { createContext, useContext, useRef, useState } from 'react';
import { animate, motion, useInView, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'motion/react';

/** Counts up to a number when it scrolls into view (Magic UI style number ticker). */
export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString(language()) }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const from = useRef(0);
  React.useEffect(() => {
    const el = ref.current; if (!el || !inView) return;
    if (prefersLessMotion()) { el.textContent = format(value); from.current = value; return; }
    const controls = animate(from.current, value, { duration: .9, ease: [.2, .8, .2, 1], onUpdate: v => { el.textContent = format(v); } });
    from.current = value;
    return () => controls.stop();
  }, [value, inView]);
  return <span ref={ref} className="count-up">{format(0)}</span>;
}

/** True when the user or OS asked for less motion. */
export const prefersLessMotion = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Cursor-follow 3D tilt with a soft glare (pointer devices only). */
export function useTilt(max = 7) {
  const px = useMotionValue(.5), py = useMotionValue(.5);
  const spring = { stiffness: 260, damping: 24, mass: .6 };
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), spring);
  const rotateX = useSpring(useTransform(py, [0, 1], [max * .8, -max * .8]), spring);
  const gx = useTransform(px, v => `${v * 100}%`), gy = useTransform(py, v => `${v * 100}%`);
  const glare = useMotionTemplate`radial-gradient(circle at ${gx} ${gy}, rgb(255 255 255 / .22), transparent 55%)`;
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || prefersLessMotion()) return;
    const r = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - r.left) / r.width); py.set((event.clientY - r.top) / r.height);
  };
  const onPointerLeave = () => { px.set(.5); py.set(.5); };
  return { style: { rotateX, rotateY, transformPerspective: 900 }, glare, handlers: { onPointerMove, onPointerLeave } };
}
import {
  Activity, ArrowDownToLine, BookOpen, Check, ChevronRight, Code2, Copy, FileText, FolderPlus, Gamepad2, Heart, Image, Info, Library,
  MoreHorizontal, PackageOpen, Pencil, Play, RefreshCw, Share2, Trash2, type LucideIcon,
} from 'lucide-react';
import { tagsWithMark } from './contentMarks';
import { RatingBadge } from './contentNote';
import type { ContentType, LibraryItem } from './types';
import { rovingKeys, useReturnFocus } from './a11y';

export type Page = 'item' | 'home' | 'library' | 'favorites' | 'recent' | 'learning' | 'games' | 'collections' | 'import' | 'studio' | 'storage' | 'sharing' | 'admin' | 'login' | 'settings';

export const TYPE_LABEL: Record<ContentType, string> = { game: t('Game'), learning: t('Learning'), app: t('App'), tool: t('Tool'), simulation: t('Simulation'), presentation: t('Presentation'), document: 'PDF', quiz: t('Quiz'), other: t('Project') };

export const TYPE_PLURAL: Record<ContentType, string> = { game: t('Games'), learning: t('Learning'), app: t('Apps'), tool: t('Tools'), simulation: t('Simulations'), presentation: t('Presentations'), document: 'PDFs', quiz: t('Quizzes'), other: t('Projects') };

export const TYPE_ICON: Record<ContentType, LucideIcon> = { game: Gamepad2, learning: BookOpen, app: Library, tool: Activity, simulation: Activity, presentation: Image, document: FileText, quiz: Check, other: PackageOpen };

export const base = import.meta.env.BASE_URL;

export function go(page: Page, suffix = '') { location.hash = `/${page}${suffix}`; }

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toLocaleString(language(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  return `${(value / 1024 ** 3).toLocaleString(language(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;
}

export function friendlyDate(value?: number | null): string {
  return value ? new Intl.DateTimeFormat(language(), { dateStyle: 'medium' }).format(value) : t('Never opened');
}

export function formatRoutePath(id: string, path: string): string {
  return `${base}__localdeck_asset/${encodeURIComponent(id)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1 aria-label={title}>{title.split(' ').map((word, i) => <span key={`${word}-${i}`} className="blur-word" style={{ '--i': i } as React.CSSProperties} aria-hidden="true">{word}{' '}</span>)}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>;
}

export const OPEN_VERB: Record<ContentType, string> = { game: t('Play'), learning: t('Read'), app: t('Open'), tool: t('Open'), simulation: t('Run simulation'), presentation: t('Present'), document: t('Read'), quiz: t('Start quiz'), other: t('Open') };

export const COVER_HUES: Record<ContentType, [number, number]> = { game: [262, 322], learning: [212, 252], app: [196, 232], tool: [24, 345], simulation: [166, 206], presentation: [36, 6], document: [222, 262], quiz: [148, 96], other: [250, 290] };

/** Deterministic generated artwork used when a project has no cover of its own. */

export function generatedCoverImage(item: LibraryItem): string {
  const seed = `${item.title}|${item.subject}|${item.type}`;
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  let state = hash >>> 0;
  const rand = () => { state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return state / 4294967296; };
  const [h1, h2] = COVER_HUES[item.type] ?? COVER_HUES.other;
  const a = h1 + Math.round(rand() * 24 - 12), b = h2 + Math.round(rand() * 24 - 12);
  const gx = Math.round(320 + rand() * 220), gy = Math.round(rand() * 140);
  const tilt = Math.round(rand() * 24 - 12);
  const ink = `hsl(${b} 90% 82%)`;
  let motif = '';
  if (item.type === 'game') {
    for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) if (rand() > .45) motif += `<rect x="${x * 30}" y="${y * 30}" width="24" height="24" rx="6" fill="${ink}" opacity="${(.16 + rand() * .5).toFixed(2)}"/>`;
    motif = `<g transform="translate(300 40) rotate(${tilt} 105 75)">${motif}</g>`;
  } else if (item.type === 'learning' || item.type === 'document') {
    let lines = ''; for (let i = 0; i < 7; i++) lines += `<rect x="34" y="${54 + i * 22}" width="${Math.round(110 + rand() * 90)}" height="7" rx="3.5" fill="hsl(${a} 40% 30%)" opacity="${i === 0 ? .9 : .35}"/>`;
    motif = `<g transform="translate(320 34) rotate(${tilt} 120 120)"><rect width="230" height="250" rx="18" fill="#fff" opacity=".92"/><rect x="20" y="0" width="3" height="250" fill="hsl(${b} 80% 60%)" opacity=".7"/>${lines}</g>`;
  } else if (item.type === 'quiz') {
    for (let i = 0; i < 4; i++) { const done = rand() > .4; motif += `<g transform="translate(0 ${i * 52})"><rect width="230" height="40" rx="12" fill="#fff" opacity="${done ? .9 : .22}"/><circle cx="22" cy="20" r="9" fill="${done ? `hsl(${a} 70% 45%)` : 'none'}" stroke="#fff" stroke-width="2"/><rect x="44" y="16" width="${Math.round(80 + rand() * 90)}" height="8" rx="4" fill="${done ? `hsl(${a} 40% 30%)` : '#fff'}" opacity=".5"/></g>`; }
    motif = `<g transform="translate(310 52) rotate(${tilt / 2} 115 100)">${motif}</g>`;
  } else if (item.type === 'simulation') {
    for (let i = 0; i < 4; i++) motif += `<ellipse cx="430" cy="140" rx="${60 + i * 42}" ry="${22 + i * 16}" fill="none" stroke="${ink}" stroke-width="1.5" opacity="${(.55 - i * .1).toFixed(2)}" transform="rotate(${tilt - 18} 430 140)"/>`;
    for (let i = 0; i < 5; i++) { const ang = rand() * Math.PI * 2, r = 60 + Math.floor(rand() * 4) * 42; motif += `<circle cx="${(430 + Math.cos(ang) * r).toFixed(1)}" cy="${(140 + Math.sin(ang) * r * .4).toFixed(1)}" r="${(4 + rand() * 6).toFixed(1)}" fill="#fff" opacity=".9"/>`; }
    motif += `<circle cx="430" cy="140" r="20" fill="${ink}"/>`;
  } else if (item.type === 'presentation') {
    let bars = ''; for (let i = 0; i < 5; i++) { const hgt = Math.round(30 + rand() * 90); bars += `<rect x="${28 + i * 38}" y="${170 - hgt}" width="24" height="${hgt}" rx="6" fill="hsl(${a + i * 8} 75% 55%)"/>`; }
    motif = `<g transform="translate(300 40) rotate(${tilt / 2} 125 100)"><rect width="250" height="200" rx="18" fill="#fff" opacity=".92"/>${bars}</g>`;
  } else if (item.type === 'app' || item.type === 'tool') {
    for (let i = 0; i < 4; i++) motif += `<rect x="${(i % 2) * 96}" y="${Math.floor(i / 2) * 96}" width="80" height="80" rx="22" fill="${i === Math.floor(rand() * 4) ? '#fff' : ink}" opacity="${i === 0 ? .95 : (.3 + rand() * .4).toFixed(2)}"/>`;
    motif = `<g transform="translate(340 46) rotate(${tilt} 88 88)">${motif}</g>`;
  } else {
    for (let i = 0; i < 4; i++) motif += `<path d="M260 ${120 + i * 34}C340 ${80 + i * 34} 400 ${170 + i * 34} 560 ${110 + i * 34}" fill="none" stroke="${ink}" stroke-width="3" opacity="${(.6 - i * .12).toFixed(2)}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 350" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${a} 58% 20%)"/><stop offset="1" stop-color="hsl(${b} 62% 42%)"/></linearGradient><radialGradient id="g"><stop stop-color="hsl(${b} 95% 72%)" stop-opacity=".75"/><stop offset="1" stop-color="hsl(${b} 95% 72%)" stop-opacity="0"/></radialGradient></defs><rect width="560" height="350" fill="url(#b)"/><circle cx="${gx}" cy="${gy}" r="240" fill="url(#g)"/><circle cx="${Math.round(rand() * 160)}" cy="330" r="150" fill="hsl(${a} 70% 55%)" opacity=".18"/>${motif}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** CSS background for a project: its own cover when present, generated art underneath as a fallback. */

/** Object URLs for covers read straight from IndexedDB, used while the service worker is not controlling the page. */
const coverCache = new Map<string, string>();
export function cacheCover(itemId: string, path: string, blob: Blob): void {
  const key = `${itemId}\n${path}`;
  if (!coverCache.has(key)) coverCache.set(key, URL.createObjectURL(blob));
}
export const hasCachedCover = (itemId: string, path: string) => coverCache.has(`${itemId}\n${path}`);

export function coverBackground(item: LibraryItem): string {
  const fallback = generatedCoverImage(item);
  const path = item.artworkReferences.cover;
  if (!path) return fallback;
  const url = coverCache.get(`${item.id}\n${path}`) ?? formatRoutePath(item.id, path);
  return `url("${url}"), ${fallback}`;
}

export function EmptyState({icon:Icon,title,detail,action}:{icon:LucideIcon;title:string;detail:string;action?:React.ReactNode}) { return <div className="empty-state"><div className="empty-icon"><Icon size={21}/></div><h2>{title}</h2><p>{detail}</p>{action}</div>; }

export function PreviewIcon({type}:{type:ContentType}) { const Icon=TYPE_ICON[type]; return <Icon size={19}/>; }

/** Every action a project card or row can trigger. Provided once by App. */
export type ItemActions = {
  open: (item: LibraryItem) => void;
  details: (item: LibraryItem) => void;
  favorite: (item: LibraryItem) => void;
  edit: (item: LibraryItem) => void;
  describe: (item: LibraryItem, changes: Pick<LibraryItem, 'title' | 'type' | 'subject' | 'topic' | 'description' | 'tags' | 'contentCheck'>) => Promise<void>;
  /** Marks a project as fine although the check was unsure. */
  confirmContent: (item: LibraryItem) => void;
  showTag: (tag: string) => void;
  editCode: (item: LibraryItem) => void;
  update: (item: LibraryItem, file: File) => Promise<void>;
  collect: (item: LibraryItem) => void;
  share: (item: LibraryItem) => void;
  remove: (item: LibraryItem) => void;
  exportOne: (item: LibraryItem) => void;
  duplicate: (item: LibraryItem) => void;
};
export const ItemActionsContext = createContext<ItemActions | null>(null);
export function useItemActions(): ItemActions {
  const value = useContext(ItemActionsContext);
  if (!value) throw new Error('ItemActionsContext is missing.');
  return value;
}

/** "#word" finds hashtags, anything else looks at all details. */
export function matchesQuery(item: LibraryItem, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q.startsWith('#')) { const tag = q.slice(1).trim(); return tagsWithMark(item.tags, item.contentCheck).some(entry => entry.toLocaleLowerCase().startsWith(tag)); }
  return [item.title, item.description, item.type, item.subject, item.topic, item.genre, ...item.tags].join(' ').toLocaleLowerCase().includes(q);
}

export const isHtmlItem = (item: LibraryItem) => /\.html?$/i.test(item.entryFile);
export function itemSubtitle(item: LibraryItem): string { return [TYPE_LABEL[item.type], item.subject || item.genre].filter(Boolean).join(' · '); }

/** Menu entries shared by the card dropdown, list rows and right-click. */
export function ItemMenu({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const a = useItemActions();
  const run = (fn: () => void) => () => { onClose(); fn(); };
  const menu = useRef<HTMLDivElement>(null);
  useReturnFocus();
  const marker = useRef<HTMLSpanElement>(null);
  // The menu is drawn above the whole page. Inside its card, other panels could cover it or cut it off.
  // Phones get a sheet at the bottom, larger screens get it next to the button that opened it.
  const [sheet] = useState(() => matchMedia('(max-width: 640px)').matches);
  React.useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    if (!sheet) {
      const button = marker.current?.closest('.item-card, .item-row, .details-more')?.querySelector('[aria-expanded="true"]');
      const anchor = (button ?? marker.current?.parentElement)?.getBoundingClientRect();
      const { offsetWidth: width, offsetHeight: height } = element;
      if (anchor) {
        const below = anchor.bottom + 6;
        const top = below + height <= innerHeight - 10 ? below : anchor.top - 6 - height;
        element.style.top = `${Math.max(10, Math.min(top, innerHeight - height - 10))}px`;
        element.style.left = `${Math.max(10, Math.min(anchor.right - width, innerWidth - width - 10))}px`;
      }
    }
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [sheet]);
  const close = useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    if (sheet) return;
    const onMove = (event: Event) => { if (!(event.target instanceof Node && menu.current?.contains(event.target))) close.current(); };
    window.addEventListener('scroll', onMove, true); window.addEventListener('resize', onMove);
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  }, [sheet]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    rovingKeys(event, '[role="menuitem"]');
  };
  // React passes events from here on to the card, which must not tilt because of them.
  const content = <div className="item-menu-layer" onPointerMove={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}><button className={sheet ? 'menu-dismiss-sheet' : 'menu-dismiss'} tabIndex={-1} aria-hidden="true" onClick={onClose} /><div ref={menu} className={`item-menu ${sheet ? 'item-menu-sheet' : ''}`} role="menu" aria-label={t('Actions for {0}', item.title)} onKeyDown={onKeyDown}>
    {sheet && <div className="item-menu-title" role="presentation">{item.title}</div>}
    <button role="menuitem" onClick={run(() => a.details(item))}><Info size={15}/> {t('View details')}</button>
    <button role="menuitem" onClick={run(() => a.edit(item))}><Pencil size={15}/> {t('Edit details')}</button>
    {isHtmlItem(item) && <button role="menuitem" onClick={run(() => a.editCode(item))}><Code2 size={15}/> {t('Edit HTML code')}</button>}
    <button role="menuitem" onClick={run(() => a.collect(item))}><FolderPlus size={15}/> {t('Add to collection')}</button>
    <button role="menuitem" onClick={run(() => a.share(item))}><Share2 size={15}/> {t('Create encrypted link')}</button>
    <button role="menuitem" onClick={run(() => a.duplicate(item))}><Copy size={15}/> {t('Make a copy')}</button>
    <button role="menuitem" onClick={run(() => a.exportOne(item))}><ArrowDownToLine size={15}/> {t('Export project')}</button>
    <button role="menuitem" className="danger-menu" onClick={run(() => a.remove(item))}><Trash2 size={15}/> {t('Remove from library')}</button>
  </div></div>;
  return <><span ref={marker} hidden/>{createPortal(content, document.body)}</>;
}

export function ItemCard({ item, index = 0, compact = false }: { item: LibraryItem; index?: number; compact?: boolean }) {
  const a = useItemActions();
  const [menu, setMenu] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateInput = useRef<HTMLInputElement>(null);
  const Icon = TYPE_ICON[item.type];
  const tilt = useTilt();
  const handleUpdate = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setUpdating(true);
    try { await a.update(item, file); } finally { setUpdating(false); }
  };
  return <motion.article className={`item-card ${compact ? 'item-card-compact' : ''}`} layout="position" initial={{ opacity: 0, y: 14, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ type: 'spring', bounce: .18, visualDuration: .45, delay: Math.min(index * .035, .28) }}
    whileHover={{ y: -5 }} whileTap={{ scale: .985 }} style={tilt.style} {...tilt.handlers}
    onContextMenu={event => { event.preventDefault(); setMenu(true); }}>
    <motion.span className="card-glare" style={{ backgroundImage: tilt.glare }} aria-hidden="true" />
    <button className={`item-cover cover-${item.type}`} onClick={() => a.open(item)} aria-label={`${OPEN_VERB[item.type]} ${item.title}`}>
      <span className="cover-type"><Icon size={17}/></span>
      <RatingBadge check={item.contentCheck}/>
      <span className="cover-title">{item.title}</span>
      <span className="cover-meta">{item.subject || item.genre || TYPE_LABEL[item.type]}</span>
      <span className="cover-play"><Play size={14} fill="currentColor"/></span>
      <span className={`cover-art ${item.artworkReferences.cover ? 'cover-art-user' : ''}`} style={{ backgroundImage: coverBackground(item) }} aria-hidden="true" />
    </button>
    <div className="item-info">
      <div className="item-title-row">
        <button className="item-title-button" onClick={() => a.details(item)} title={t('View details')}><b>{item.title}</b><small>{itemSubtitle(item)}</small></button>
        <button className={`icon-button favorite-button ${item.favorite ? 'favorite-on' : ''}`} onClick={() => a.favorite(item)} aria-pressed={item.favorite} aria-label={item.favorite ? t('Remove {0} from favorites', item.title) : t('Add {0} to favorites', item.title)}><Heart size={17} fill={item.favorite ? 'currentColor' : 'none'}/></button>
        <button className="icon-button item-menu-button" onClick={() => setMenu(v => !v)} aria-expanded={menu} aria-label={t('More actions for {0}', item.title)}><MoreHorizontal size={18}/></button>
      </div>
      <div className="item-foot"><span>{plural(item.fileCount, '{0} · {1} file', '{0} · {1} files', bytes(item.storageSize), item.fileCount)}</span>
        <input ref={updateInput} className="visually-hidden" type="file" accept=".zip,.html,.htm,.pdf,application/zip,text/html,application/pdf" onChange={event => void handleUpdate(event)} tabIndex={-1}/>
        <button className="update-project-button" onClick={() => updateInput.current?.click()} disabled={updating} aria-label={t('Update {0} project files', item.title)} title={t('Replace this project’s files')}><RefreshCw size={12} className={updating ? 'spin' : ''}/>{updating ? t('Updating…') : t('Update')}</button>
      </div>
      {menu && <ItemMenu item={item} onClose={() => setMenu(false)} />}
    </div>
  </motion.article>;
}

export function ItemRow({ item, meta }: { item: LibraryItem; meta?: React.ReactNode }) {
  const a = useItemActions();
  const [menu, setMenu] = useState(false);
  return <div className="item-row" onContextMenu={event => { event.preventDefault(); setMenu(true); }}>
    <button className="item-row-cover" style={{ backgroundImage: coverBackground(item) }} onClick={() => a.open(item)} aria-label={`${OPEN_VERB[item.type]} ${item.title}`}><Play size={14} fill="currentColor"/></button>
    <button className="item-row-main" onClick={() => a.details(item)}><b>{item.title}</b><small>{itemSubtitle(item)}</small></button>
    <RatingBadge check={item.contentCheck}/>
    <span className="item-row-meta">{meta ?? bytes(item.storageSize)}</span>
    <button className={`icon-button ${item.favorite ? 'favorite-on' : ''}`} onClick={() => a.favorite(item)} aria-pressed={item.favorite} aria-label={item.favorite ? t('Remove {0} from favorites', item.title) : t('Add {0} to favorites', item.title)}><Heart size={16} fill={item.favorite ? 'currentColor' : 'none'}/></button>
    <button className="button item-row-open" onClick={() => a.open(item)}>{OPEN_VERB[item.type]}</button>
    <button className="icon-button" onClick={() => setMenu(v => !v)} aria-expanded={menu} aria-label={t('More actions for {0}', item.title)}><MoreHorizontal size={18}/></button>
    {menu && <ItemMenu item={item} onClose={() => setMenu(false)} />}
  </div>;
}

/** A titled section with a limited grid of cards and an optional "See all" link. */
export function Shelf({ title, detail, items, limit = 8, seeAll }: { title: string; detail?: string; items: LibraryItem[]; limit?: number; seeAll?: { label?: string; onClick: () => void } }) {
  if (!items.length) return null;
  return <motion.section className="section-block shelf" initial={{ opacity: 0, y: 26 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ type: 'spring', bounce: .15, visualDuration: .55 }}>
    <div className="section-title-row"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{seeAll && items.length > limit && <button className="text-button" onClick={seeAll.onClick}>{seeAll.label ?? t('See all')} <ChevronRight size={15}/></button>}</div>
    <div className="item-grid">{items.slice(0, limit).map((item, index) => <ItemCard key={item.id} item={item} index={index} compact />)}</div>
  </motion.section>;
}

/** Single-choice filter chips with optional counts. */
export function Chips<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string; count?: number; icon?: LucideIcon }>; value: T; onChange: (value: T) => void; label: string }) {
  return <div className="chips" role="radiogroup" aria-label={label} onKeyDown={event => rovingKeys(event, '[role="radio"]', true)}>{options.map(option => { const Icon = option.icon; return <button key={option.value} type="button" role="radio" aria-checked={value === option.value} tabIndex={value === option.value ? 0 : -1} className={`chip ${value === option.value ? 'active' : ''}`} onClick={() => onChange(option.value)}>{Icon && <Icon size={14}/>}{option.label}{option.count !== undefined && <small>{option.count}</small>}</button>; })}</div>;
}

/** Stable color for a free-text subject or genre name. */
export function colorFor(name: string): string {
  const palette = ['#7AA2F7', '#5CC8E0', '#A78BFA', '#F08091', '#E58AD6', '#F6C76A', '#F59E6B', '#5DD5A2', '#9BE38B'];
  let hash = 0; for (const char of name.toLocaleLowerCase()) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length]!;
}

export const LEARNING_TYPES: ContentType[] = ['learning', 'quiz', 'document', 'presentation'];
export const PLAY_TYPES: ContentType[] = ['game', 'app', 'tool', 'simulation'];
