/* What describes projects on this device. 'instant' needs no model and always works (services/quickScan). Better
   descriptions come from the AI that some browsers already contain, or from Qwen, which is loaded into the browser
   once. Nothing leaves the device. When a model cannot run, 'instant' does the work. */
import { create } from 'zustand';
import { storedShare } from './parts';
import { MODEL, type ChatMessage, type FromWorker, type ToWorker } from './model';

/** 'none': the person turned it off. */
export type EngineId = 'none' | 'instant' | 'browser' | 'qwen';
/** Why a model cannot run: the browser has no WebGPU, the graphics chip is not available to it, or it only draws in software. */
export type Gpu = 'unknown' | 'ok' | 'missing' | 'blocked' | 'software';
export type Phase = 'checking' | 'unsupported' | 'off' | 'loading' | 'preparing' | 'ready' | 'failed';
type State = { phase: Phase; engine: EngineId; browserAi: boolean; webgpu: boolean; gpu: Gpu; stored: boolean; share: number; loaded: number; total: number; error: '' | 'network' | 'memory' | 'webgpu' | 'space' | 'crash' | 'other' };

const ENGINE_KEY = 'localdeck-ai-engine', STORED_KEY = 'localdeck-ai-stored', START_KEY = 'localdeck-ai-starting';
const IDLE_MS = 10 * 60_000;
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

const savedEngine = (): EngineId => { const saved = read(ENGINE_KEY); return saved === 'browser' || saved === 'qwen' || saved === 'none' ? saved : 'instant'; };

export const useLocalAi = create<State>(() => ({ phase: 'checking', engine: savedEngine(), browserAi: false, webgpu: false, gpu: 'unknown', stored: false, share: 0, loaded: 0, total: MODEL.bytes, error: '' }));
const set = useLocalAi.setState, get = useLocalAi.getState;

let worker: Worker | null = null;
let nextId = 1;
/** Notices when loading or starting gets stuck. */
let watch = 0, lastSign = 0;
const STUCK_LOADING_MS = 120_000, STUCK_STARTING_MS = 180_000;
let idle = 0;
type Pending = { onText: (text: string) => void; resolve: (text: string) => void; reject: (error: Error) => void; text: string };
const pending = new Map<number, Pending>();
let loading: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | null = null;

type BrowserSession = { prompt: (input: string, options?: { signal?: AbortSignal }) => Promise<string>; promptStreaming?: (input: string, options?: { signal?: AbortSignal }) => AsyncIterable<string>; destroy?: () => void };
type BrowserModel = { availability: () => Promise<string>; create: (options: object) => Promise<BrowserSession> };
const browserModel = () => (window as unknown as { LanguageModel?: BrowserModel }).LanguageModel;
let browserAbort: AbortController | null = null;

/** A hidden tab or a stuck driver may never answer, so there is a limit. */
async function findGpu(): Promise<Gpu> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<object | null> } }).gpu;
  if (!gpu) return 'missing';
  const adapter = await Promise.race([gpu.requestAdapter().catch(() => null), new Promise<null>(resolve => { window.setTimeout(() => resolve(null), 6000); })]);
  if (!adapter) return 'blocked';
  const found = adapter as { isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } };
  return found.isFallbackAdapter || found.info?.isFallbackAdapter ? 'software' : 'ok';
}

/** Looks again, for example after the browser was restarted or the graphics driver came back. */
export function checkAgain(): Promise<void> { checked = null; set({ phase: 'checking', error: '' }); return checkLocalAi(); }

/** True when a real model can answer now without loading it from the internet first. */
export function modelUsable(): boolean {
  const { engine, stored, phase } = get();
  return engine === 'browser' || (engine === 'qwen' && (stored || phase === 'ready') && phase !== 'failed' && phase !== 'unsupported');
}

let checked: Promise<void> | null = null;
/** Looks at what this device can do. Loads nothing. */
export function checkLocalAi(): Promise<void> {
  checked ??= (async () => {
    const gpu = await findGpu(), webgpu = gpu === 'ok';
    const browserAi = await browserModel()?.availability().then(value => value === 'available').catch(() => false) ?? false;
    let stored = false;
    let share = 0;
    try { if (await caches.has(MODEL.cache)) share = await storedShare(await caches.open(MODEL.cache)); stored = share === 1 && read(STORED_KEY) === MODEL.revision; } catch { /* no cache in private windows */ }
    if (!stored) write(STORED_KEY, null);
    const saved = savedEngine(), engine: EngineId = saved === 'browser' && !browserAi ? 'instant' : saved;
    // The page disappeared while the model was starting. Doing that again would close it again.
    const crashed = engine === 'qwen' && read(START_KEY) !== null;
    write(START_KEY, null);
    set({ webgpu, gpu, browserAi, stored, share, engine, ...(crashed ? { phase: 'failed' as const, error: 'crash' as const } : { phase: engine === 'browser' ? 'ready' as const : webgpu ? 'off' as const : 'unsupported' as const }) });
  })();
  return checked;
}

export function chooseEngine(engine: EngineId): void {
  write(ENGINE_KEY, engine);
  set({ engine, error: '', phase: engine === 'browser' ? 'ready' : engine === 'qwen' && worker && !loading ? 'ready' : get().webgpu ? 'off' : 'unsupported' });
}

function kind(message: string): State['error'] {
  if (/no-webgpu/.test(message)) return 'webgpu';
  if (/memory|device.*lost|lost.*device|bad_alloc/i.test(message)) return 'memory';
  if (/quota|storage/i.test(message)) return 'space';
  if (/fetch|network|load failed|http|connection/i.test(message)) return 'network';
  if (/memory|allocat|buffer|device.*lost|out of|bad_alloc|aborted/i.test(message)) return 'memory';
  return 'other';
}

function stopWorker(reason: string): void {
  window.clearInterval(watch);
  write(START_KEY, null);
  worker?.terminate(); worker = null;
  for (const entry of pending.values()) entry.reject(new Error(reason));
  pending.clear();
}

function keepAlive(): void {
  window.clearTimeout(idle);
  // Gives the memory back when the model is not used for a while. Loading again needs no internet.
  idle = window.setTimeout(() => { if (!pending.size && worker && !loading) { stopWorker('idle'); if (get().engine === 'qwen') set({ phase: 'off' }); } }, IDLE_MS);
}

let failCurrent: (message: string) => void = () => undefined;
// A page that is closed on purpose is no crash.
window.addEventListener('pagehide', () => write(START_KEY, null));

function startWorker(): Worker {
  const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  failCurrent = message => failLoading(message);
  const failLoading = (message: string) => { stopWorker(message); const error = kind(message); set({ phase: 'failed', error: error === 'webgpu' && get().webgpu ? 'memory' : error }); loading?.reject(new Error(message)); loading = null; };
  created.onmessage = (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    lastSign = Date.now();
    if (message.type === 'progress') { if (message.loaded >= message.total && get().stored) write(START_KEY, '1'); set({ loaded: message.loaded, total: message.total }); }
    else if (message.type === 'preparing') { write(START_KEY, '1'); set({ phase: 'preparing' }); }
    else if (message.type === 'ready') { window.clearInterval(watch); write(START_KEY, null); write(STORED_KEY, MODEL.revision); set({ phase: 'ready', stored: true, share: 1, error: '' }); loading?.resolve(); loading = null; keepAlive(); }
    else if (message.type === 'token') { const entry = pending.get(message.id); if (entry) { entry.text += message.text; entry.onText(entry.text); } }
    else if (message.type === 'done') { pending.get(message.id)?.resolve(message.text); pending.delete(message.id); keepAlive(); }
    else if (message.id === null) failLoading(message.error);
    else { pending.get(message.id)?.reject(new Error(message.error)); pending.delete(message.id); 
      // After an error the GPU session can be broken, so the next request starts a fresh one from the browser's storage.
      stopWorker(message.error);
      if (get().engine === 'qwen') set(kind(message.error) === 'memory' ? { phase: 'failed', error: 'memory' } : { phase: 'off' });
    }
  };
  created.onerror = event => failLoading(event.message || 'worker');
  return created;
}

/** Loads Qwen. The first time from the internet, later from the browser's own storage. */
export async function loadLocalAi(): Promise<void> {
  await checkLocalAi();
  if (get().engine === 'none') throw new Error('no-ai');
  if (get().engine === 'instant') throw new Error('no-ai');
  if (get().engine === 'browser' || get().phase === 'ready') return;
  if (loading) return loading.promise;
  if (!get().webgpu) { set({ phase: 'unsupported' }); throw new Error('no-webgpu'); }
  if (!get().stored) {
    const { quota = 0, usage = 0 } = await navigator.storage?.estimate?.().catch(() => ({})) as { quota?: number; usage?: number } ?? {};
    if (quota && quota - usage < MODEL.bytes * (1.1 - get().share)) { set({ phase: 'failed', error: 'space' }); throw new Error('space'); }
  }
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => undefined);
  loading = { promise, resolve, reject };
  set({ phase: 'loading', error: '', loaded: 0, total: MODEL.bytes });
  // Asks the browser not to throw the model away when space gets tight.
  void navigator.storage?.persist?.().catch(() => false);
  worker ??= startWorker();
  lastSign = Date.now();
  window.clearInterval(watch);
  watch = window.setInterval(() => {
    const quiet = Date.now() - lastSign;
    if (get().phase === 'loading' && quiet > STUCK_LOADING_MS) failCurrent('network: loading got stuck');
    else if (get().phase === 'preparing' && quiet > STUCK_STARTING_MS) failCurrent('memory: starting got stuck');
  }, 5000);
  worker.postMessage({ type: 'load' } satisfies ToWorker);
  return promise;
}

export function cancelLoading(): void {
  if (!loading) return;
  stopWorker('cancelled');
  loading.reject(new Error('cancelled')); loading = null;
  set({ phase: 'off', error: '' });
}

/** Deletes the model from this browser. */
export async function removeLocalAi(): Promise<void> {
  cancelLoading();
  stopWorker('removed');
  write(STORED_KEY, null);
  try { await caches.delete(MODEL.cache); } catch { /* nothing stored */ }
  set({ stored: false, share: 0, error: '', phase: get().engine === 'browser' ? 'ready' : get().webgpu ? 'off' : 'unsupported' });
}

export async function generateText(messages: ChatMessage[], onText: (text: string) => void, options: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  if (get().engine === 'instant' || get().engine === 'none') throw new Error('no-ai');
  const { maxTokens = 900, temperature = .4 } = options;
  if (get().engine === 'browser') {
    const api = browserModel();
    if (!api) throw new Error('no-browser-ai');
    browserAbort = new AbortController();
    const { signal } = browserAbort;
    const session = await api.create({ initialPrompts: messages.slice(0, -1), expectedOutputs: [{ type: 'text', languages: ['en', 'de', 'fr', 'es'] }], signal });
    try {
      const prompt = messages.at(-1)!.content;
      if (!session.promptStreaming) { const text = await session.prompt(prompt, { signal }); onText(text); return text; }
      let text = '';
      for await (const part of session.promptStreaming(prompt, { signal })) { text = part.startsWith(text) && text ? part : text + part; onText(text); }
      return text;
    } catch (error) { if (signal.aborted) return ''; throw error; }
    finally { session.destroy?.(); browserAbort = null; }
  }
  await loadLocalAi();
  if (!worker) throw new Error('not-loaded');
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { onText, resolve, reject, text: '' });
    worker!.postMessage({ type: 'generate', id, messages, maxTokens, temperature } satisfies ToWorker);
  });
}

export function stopGenerating(): void {
  browserAbort?.abort();
  worker?.postMessage({ type: 'stop' } satisfies ToWorker);
}
