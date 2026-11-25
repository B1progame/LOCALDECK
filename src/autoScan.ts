/* Checks every imported project: at once by rules, then described by the quick scan or by the local AI that is chosen
   in Settings. One project after the other, in the background. */
import { create } from 'zustand';
import { useContentMarks } from './contentMarks';
import { language } from './i18n';
import { checkLocalAi, generateText, loadLocalAi, modelUsable, onCpu, plainQuestions, useLocalAi } from './localAi/engine';
import { checkContent, withOpinion, type ContentCheck } from './services/contentCheck';
import { db } from './services/database';
import { getAssets, updateItem } from './services/library';
import { htmlText, importantTags, isPlaceholderTitle, scriptTexts, suggestDetails, type ProjectText, type ScanResult } from './services/projectScan';
import { quickScan } from './services/quickScan';
import { smallDetails } from './services/smallScan';
import { TYPE_LABEL } from './shared';
import type { ContentType, LibraryItem } from './types';

const AUTO_KEY = 'localdeck-ai-auto';
const MAX_FILE = 8 * 1024 * 1024;
export const ITEMS_CHANGED = 'localdeck-items-changed';

type Queue = { active: string | null; waiting: string[]; done: number; total: number; auto: boolean };
const readAuto = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
export const useAutoScan = create<Queue>(() => ({ active: null, waiting: [], done: 0, total: 0, auto: readAuto() }));
const set = useAutoScan.setState, get = useAutoScan.getState;

export function setAutoScan(auto: boolean): void {
  try { localStorage.setItem(AUTO_KEY, auto ? '1' : '0'); } catch { /* storage unavailable */ }
  set({ auto });
  if (!auto) cancelWaiting();
}

/** True unless the person turned scanning off. The quick scan always works. */
export const scanIsOn = () => useLocalAi.getState().engine !== 'none';
/** True when a real model can answer without loading it from the internet first. */
export async function modelIsReady(): Promise<boolean> { await checkLocalAi(); return modelUsable(); }

/* ---------- One task at a time ---------- */

let chain: Promise<unknown> = Promise.resolve();
/** Runs `task` when the AI is free. Only one task uses it at a time. */
export function withAi<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => { set({ active: key }); try { return await task(); } finally { set({ active: null }); } });
  chain = run.catch(() => undefined);
  return run;
}

/* ---------- Reading ---------- */

export type SourceFile = { path: string; blob: Blob; size: number };
export type ReadProject = ProjectText & { source: string };

/** The entry page first, then the other pages, then the texts of scripts and data files. */
export async function readProjectText(files: SourceFile[], entryPath: string): Promise<ReadProject> {
  const entry = files.find(file => file.path === entryPath);
  if (!entry || !/\.html?$/i.test(entryPath) || entry.size > MAX_FILE) throw new Error('no-entry');
  const source = await entry.blob.text();
  const project = htmlText(source);
  const more: string[] = [];
  for (const file of files) {
    if (file === entry || file.size > MAX_FILE || file.path === 'localdeck.json') continue;
    if (/\.html?$/i.test(file.path)) more.push(htmlText(await file.blob.text()).text);
    else if (/\.(m?js|json)$/i.test(file.path)) more.push([...new Set(scriptTexts(await file.blob.text()))].join('\n'));
    else if (/\.(txt|md|csv)$/i.test(file.path)) more.push(await file.blob.text());
  }
  return { ...project, source, text: [project.text, ...more].filter(Boolean).join('\n') };
}
export async function readItem(item: LibraryItem): Promise<ReadProject> {
  return readProjectText((await getAssets(item.id)).map(asset => ({ path: asset.normalizedPath, blob: asset.blob, size: asset.fileSize })), item.entryFile);
}

type Named = Pick<LibraryItem, 'title' | 'description' | 'tags' | 'subject' | 'topic'>;
export const ruleCheck = (project: ReadProject, named: Named): ContentCheck => checkContent({ top: [named.title, named.subject, named.topic, named.description, ...named.tags, project.title, project.description, ...project.headings].join('\n'), text: project.text, source: project.source });

export function languageName(code: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code || language()) ?? 'English'; } catch { return 'English'; }
}

/** Describes a project: with the model when one is ready, otherwise with the quick scan. Call it inside withAi. */
export async function askAbout(project: ReadProject, filename: string, options: { onStep?: (step: number, steps: number) => void; cancelled?: () => boolean } = {}): Promise<ScanResult> {
  if (options.cancelled?.()) throw new Error('cancelled');
  if (!scanIsOn()) throw new Error('no-ai');
  // This never starts the large download by itself. That only happens with the button in Settings.
  if (useLocalAi.getState().engine !== 'instant' && await modelIsReady()) {
    try {
      await loadLocalAi();
      const ask = (messages: Parameters<typeof generateText>[0], maxTokens: number) => options.cancelled?.() ? Promise.reject(new Error('cancelled')) : generateText(messages, () => undefined, { maxTokens, temperature: 0 });
      const { engine } = useLocalAi.getState();
      if (plainQuestions(engine)) return await smallDetails(project, { filename, fallback: language(), ask, ...(onCpu(engine) ? {} : { chars: 4500 }), ...options });
      return await suggestDetails(project, {
        filename, language: languageName(project.language), ...options, rate: useContentMarks.getState().on, ask,
      });
    } catch (error) {
      if (options.cancelled?.() || (error instanceof Error && ['cancelled', 'removed'].includes(error.message))) throw error;
      console.warn('The model could not answer, the quick scan takes over', error);
    }
  }
  return quickScan(project, { filename, fallback: language() });
}

/* ---------- Imports ---------- */

const changed = (title?: string) => window.dispatchEvent(new CustomEvent(ITEMS_CHANGED, { detail: title ?? '' }));
const cancelled = new Set<string>();

export function cancelWaiting(): void {
  for (const id of get().waiting) cancelled.add(id);
  set({ waiting: [], done: 0, total: 0 });
}

/** The kind as a hashtag, such as Quiz. "Project" says nothing. */
export const kindTag = (type: ContentType) => type === 'other' ? '' : TYPE_LABEL[type];

/** Fills only what is missing. What a person wrote stays. */
export function missingDetails(item: LibraryItem, { suggestion }: ScanResult): Partial<LibraryItem> {
  return {
    ...(suggestion.title && isPlaceholderTitle(item.title) ? { title: suggestion.title } : {}),
    ...(suggestion.type && item.type === 'other' ? { type: suggestion.type } : {}),
    ...(suggestion.subject && !item.subject ? { subject: suggestion.subject } : {}),
    ...(suggestion.topic && !item.topic ? { topic: suggestion.topic } : {}),
    ...(suggestion.description && !item.description ? { description: suggestion.description } : {}),
    tags: importantTags(item.tags, suggestion, kindTag(suggestion.type || item.type)),
  };
}

async function describe(id: string): Promise<void> {
  const item = await db.items.get(id);
  if (!item) return;
  const project = await readItem(item);
  if (!project.text && !project.title) return;
  const result = await askAbout(project, item.originalFilename, { cancelled: () => cancelled.has(id) });
  const latest = await db.items.get(id);
  if (!latest) return;
  const { suggestion } = result;
  if (!suggestion.title && !suggestion.description && !suggestion.tags.length) return;
  const details = missingDetails(latest, result);
  const rules = ruleCheck(project, { ...latest, ...details });
  const check: ContentCheck = result.quick ? { ...rules, scanned: 'quick' } : withOpinion(rules, result.found, suggestion.description);
  await updateItem(id, { ...details, contentCheck: { ...check, ...(latest.contentCheck?.confirmed ? { confirmed: true } : {}) } }, { touch: false });
  // The quick scan is done before anyone notices, so it says nothing.
  changed(result.quick ? undefined : latest.title);
}

function enqueue(id: string): void {
  if (get().waiting.includes(id) || get().active === id) return;
  cancelled.delete(id);
  set(state => ({ waiting: [...state.waiting, id], total: state.total + 1 }));
  void withAi(id, async () => {
    if (cancelled.delete(id)) return;
    set(state => ({ waiting: state.waiting.filter(entry => entry !== id) }));
    try { await describe(id); }
    catch (error) { console.warn('Project scan stopped', error); }
    finally { set(state => state.waiting.length ? { done: state.done + 1 } : { done: 0, total: 0 }); }
  });
}

/** Called after every import and after the files of a project were replaced. */
export async function scanImported(item: LibraryItem): Promise<void> {
  if (!/\.html?$/i.test(item.entryFile)) return;
  try {
    const check = ruleCheck(await readItem(item), item);
    // A summary that came with the import, for example from a shared link, stays.
    if (!(item.contentCheck?.by === 'ai')) await updateItem(item.id, { contentCheck: check }, { touch: false });
    changed();
    if (item.contentCheck?.by === 'ai' || !get().auto || !scanIsOn()) return;
    enqueue(item.id);
  } catch (error) { console.warn('Project check stopped', error); }
}

/** Projects that were never checked, or all of them by the AI. */
export async function scanLibrary(): Promise<number> {
  const items = (await db.items.toArray()).filter(item => /\.html?$/i.test(item.entryFile));
  const ready = await modelIsReady(), on = scanIsOn();
  const todo = items.filter(item => ready ? item.contentCheck?.by !== 'ai' || (useContentMarks.getState().on && !item.contentCheck.rated) : on ? !item.contentCheck?.scanned && item.contentCheck?.by !== 'ai' : !item.contentCheck);
  for (const item of todo) {
    if (!item.contentCheck) { try { await updateItem(item.id, { contentCheck: ruleCheck(await readItem(item), item) }, { touch: false }); } catch { /* unreadable project */ } }
    if (on) enqueue(item.id);
  }
  changed();
  return todo.length;
}
