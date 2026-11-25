/* What describes projects on this device. 'instant' needs no model and always works (services/quickScan). Better
   descriptions come from the AI that some browsers already contain, or from a model that is loaded into the browser
   once (model.ts): some run on the graphics chip, others on the processor of any device and take longer. Nothing
   leaves the device. When a model cannot run, 'instant' does the work. */
import { create } from 'zustand';
import { storedShare } from './parts';
import type { SmallModel } from './small';
import { MODEL_IDS, MODELS, type ChatMessage, type CpuModel, type FromWorker, type ModelId, type ToWorker } from './model';

/** 'none': the person turned it off. */
export type EngineId = 'none' | 'instant' | 'browser' | ModelId;
export const isModel = (engine: EngineId): engine is ModelId => Object.hasOwn(MODELS, engine);
export const modelOf = (engine: EngineId) => isModel(engine) ? MODELS[engine] : MODELS.small;
/** True for a model that gets plain questions instead of a form. */
export const plainQuestions = (engine: EngineId) => { const model = isModel(engine) ? MODELS[engine] : null; return model !== null && (model.runs === 'cpu' || model.plain === true); };
/** True for a model that runs on the processor. */
export const onCpu = (engine: EngineId) => isModel(engine) && MODELS[engine].runs === 'cpu';
/** Why a model cannot run: the browser has no WebGPU, the graphics chip is not available to it, or it only draws in software. */
export type Gpu = 'unknown' | 'ok' | 'missing' | 'blocked' | 'software';
export type Phase = 'checking' | 'unsupported' | 'off' | 'loading' | 'preparing' | 'ready' | 'failed';
type State = { phase: Phase; engine: EngineId; browserAi: boolean; webgpu: boolean; gpu: Gpu; cpu: boolean; stored: boolean; share: number; loaded: number; total: number; error: '' | 'network' | 'memory' | 'webgpu' | 'space' | 'crash' | 'other' };

const ENGINE_KEY = 'localdeck-ai-engine', STORED_KEY = 'localdeck-ai-stored', START_KEY = 'localdeck-ai-starting';
/** The models for the processor are for devices with little memory, so they give it back sooner. They start again in a second. */
const IDLE_MS = { gpu: 10 * 60_000, cpu: 90_000 };
const storedKey = (id: ModelId) => id === 'qwen' ? STORED_KEY : `${STORED_KEY}-${id}`;
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

const savedEngine = (): EngineId => { const saved = read(ENGINE_KEY) as EngineId | null; return saved && (saved === 'browser' || saved === 'none' || isModel(saved)) ? saved : 'instant'; };

export const useLocalAi = create<State>(() => ({ phase: 'checking', engine: savedEngine(), browserAi: false, webgpu: false, gpu: 'unknown', cpu: true, stored: false, share: 0, loaded: 0, total: 0, error: '' }));
const set = useLocalAi.setState, get = useLocalAi.getState;

let worker: Worker | null = null;
/** Which model the worker has. */
let workerModel: ModelId | null = null;
let small: SmallModel | null = null, smallModel: ModelId | null = null;
/** Ends loading or answering of the small model. */
let smallAbort: AbortController | null = null;
/** What is stored of each model. */
const have = Object.fromEntries(MODEL_IDS.map(id => [id, { stored: false, share: 0 }])) as Record<ModelId, { stored: boolean; share: number }>;
export const storedModels = () => MODEL_IDS.filter(id => have[id].share > 0);
let nextId = 1;
/** Notices when loading or starting gets stuck. */
let watch = 0, lastSign = 0;
const STUCK_LOADING_MS = 120_000, STUCK_STARTING_MS = { gpu: 180_000, cpu: 600_000 };
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

/** The processor model needs WebAssembly with SIMD and exceptions, which is in every browser since 2023. */
const SIMD = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];
const EXCEPTIONS = [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11];
const cpuWorks = () => { try { return [SIMD, EXCEPTIONS].every(bytes => WebAssembly.validate(new Uint8Array(bytes))); } catch { return false; } };

/** Looks again, for example after the browser was restarted or the graphics driver came back. */
export function checkAgain(): Promise<void> { checked = null; set({ phase: 'checking', error: '' }); return checkLocalAi(); }

/** True when a real model can answer now without loading it from the internet first. */
export function modelUsable(): boolean {
  const { engine, stored, phase } = get();
  return engine === 'browser' || (isModel(engine) && (stored || phase === 'ready') && phase !== 'failed' && phase !== 'unsupported');
}

/** The phase and what is stored, for the engine that is chosen. */
function standing(engine: EngineId): Pick<State, 'phase' | 'stored' | 'share' | 'total'> {
  const { webgpu, cpu } = get();
  const phase: Phase = engine === 'browser' ? 'ready' : !isModel(engine) ? 'off' : MODELS[engine].runs === 'gpu' ? (worker && workerModel === engine && !loading ? 'ready' : webgpu ? 'off' : 'unsupported') : small && smallModel === engine ? 'ready' : cpu ? 'off' : 'unsupported';
  // Without a model, what is stored only matters for deleting it.
  const { stored, share } = isModel(engine) ? have[engine] : { stored: MODEL_IDS.some(id => have[id].stored), share: Math.max(...MODEL_IDS.map(id => have[id].share)) };
  return { phase, stored, share, total: modelOf(engine).bytes };
}

async function look(id: ModelId): Promise<void> {
  const { cache, revision } = MODELS[id], key = storedKey(id);
  let share = 0;
  try { if (await caches.has(cache)) share = await storedShare(await caches.open(cache)); } catch { /* no cache in private windows */ }
  const stored = share === 1 && read(key) === revision;
  if (!stored) write(key, null);
  have[id] = { stored, share };
}
function remember(id: ModelId): void {
  write(storedKey(id), MODELS[id].revision);
  have[id] = { stored: true, share: 1 };
}

let checked: Promise<void> | null = null;
/** Looks at what this device can do. Loads nothing. */
export function checkLocalAi(): Promise<void> {
  checked ??= (async () => {
    const gpu = await findGpu(), webgpu = gpu === 'ok';
    const browserAi = await browserModel()?.availability().then(value => value === 'available').catch(() => false) ?? false;
    await Promise.all(MODEL_IDS.map(look));
    const saved = savedEngine(), engine: EngineId = saved === 'browser' && !browserAi ? 'instant' : saved;
    // The page disappeared while the model was starting. Doing that again would close it again.
    const crashed = isModel(engine) && read(START_KEY) !== null;
    write(START_KEY, null);
    set({ webgpu, gpu, browserAi, cpu: cpuWorks(), engine });
    set({ ...standing(engine), ...(crashed ? { phase: 'failed' as const, error: 'crash' as const } : {}) });
  })();
  return checked;
}

export function chooseEngine(engine: EngineId): void {
  write(ENGINE_KEY, engine);
  // Only one model at a time, the other one gives its memory back.
  if (engine !== workerModel && worker) stopWorker('stopped');
  if (engine !== smallModel) stopSmall();
  set({ engine, error: '', ...standing(engine) });
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
  worker?.terminate(); worker = null; workerModel = null;
  for (const entry of pending.values()) entry.reject(new Error(reason));
  pending.clear();
}

function stopSmall(): void {
  write(START_KEY, null);
  smallAbort?.abort(); smallAbort = null;
  small?.close(); small = null; smallModel = null;
}

function keepAlive(): void {
  window.clearTimeout(idle);
  const { engine } = get();
  if (!isModel(engine)) return;
  // Gives the memory back when the model is not used for a while. Loading again needs no internet.
  idle = window.setTimeout(() => {
    if (pending.size || loading || smallAbort) return;
    if (worker) stopWorker('idle');
    stopSmall();
    if (isModel(get().engine) && get().phase === 'ready') set({ phase: 'off' });
  }, IDLE_MS[MODELS[engine].runs]);
}

let failCurrent: (message: string) => void = () => undefined;
// A page that is closed on purpose is no crash.
window.addEventListener('pagehide', () => write(START_KEY, null));

function startWorker(id: ModelId): Worker {
  const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  failCurrent = message => failLoading(message);
  const failLoading = (message: string) => { stopWorker(message); const error = kind(message); set({ phase: 'failed', error: error === 'webgpu' && get().webgpu ? 'memory' : error }); loading?.reject(new Error(message)); loading = null; };
  created.onmessage = (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    lastSign = Date.now();
    if (message.type === 'progress') { if (message.loaded >= message.total && get().stored) write(START_KEY, '1'); set({ loaded: message.loaded, total: message.total }); }
    else if (message.type === 'preparing') { write(START_KEY, '1'); set({ phase: 'preparing' }); }
    else if (message.type === 'ready') { window.clearInterval(watch); write(START_KEY, null); remember(id); set({ phase: 'ready', stored: true, share: 1, error: '' }); loading?.resolve(); loading = null; keepAlive(); }
    else if (message.type === 'token') { const entry = pending.get(message.id); if (entry) { entry.text += message.text; entry.onText(entry.text); } }
    else if (message.type === 'done') { pending.get(message.id)?.resolve(message.text); pending.delete(message.id); keepAlive(); }
    else if (message.id === null) failLoading(message.error);
    else { pending.get(message.id)?.reject(new Error(message.error)); pending.delete(message.id); 
      // After an error the GPU session can be broken, so the next request starts a fresh one from the browser's storage.
      stopWorker(message.error);
      if (get().engine === id) set(kind(message.error) === 'memory' ? { phase: 'failed', error: 'memory' } : { phase: 'off' });
    }
  };
  created.onerror = event => failLoading(event.message || 'worker');
  return created;
}

async function loadSmall(info: CpuModel): Promise<void> {
  const abort = smallAbort = new AbortController();
  failCurrent = message => { abort.abort(); fail(message); };
  const fail = (message: string) => {
    if (smallAbort === abort) smallAbort = null;
    write(START_KEY, null);
    window.clearInterval(watch);
    if (!loading) return;
    loading.reject(new Error(message)); loading = null;
    set({ phase: 'failed', error: kind(message) });
  };
  try {
    const { startSmall } = await import('./small');
    const model = await startSmall(info, {
      signal: abort.signal,
      onProgress: (loaded, total) => { lastSign = Date.now(); set({ loaded, total, share: Math.max(get().share, loaded / total) }); },
      onStarting: () => { write(START_KEY, '1'); set({ phase: 'preparing' }); },
    });
    if (abort.signal.aborted) { model.close(); return; }
    small = model; smallModel = info.id; smallAbort = null;
    window.clearInterval(watch);
    write(START_KEY, null);
    remember(info.id);
    set({ phase: 'ready', stored: true, share: 1, error: '' });
    loading?.resolve(); loading = null;
    keepAlive();
  } catch (error) { if (!abort.signal.aborted) fail(error instanceof Error ? error.message : String(error)); }
}

async function askSmall(messages: ChatMessage[], onText: (text: string) => void, maxTokens: number, temperature: number): Promise<string> {
  const model = small;
  if (!model) throw new Error('not-loaded');
  const abort = smallAbort = new AbortController();
  // Reading the text cannot be interrupted, so stopping ends the whole model.
  const stopped = new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  stopped.catch(() => undefined);
  try { return await Promise.race([model.generate(messages, onText, { maxTokens, temperature, signal: abort.signal }), stopped]); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!abort.signal.aborted && message !== 'too-long') { stopSmall(); set(kind(message) === 'memory' ? { phase: 'failed', error: 'memory' } : { phase: 'off' }); }
    throw error;
  } finally { if (smallAbort === abort) smallAbort = null; keepAlive(); }
}

/** Loads the chosen model. The first time from the internet, later from the browser's own storage. */
export async function loadLocalAi(): Promise<void> {
  await checkLocalAi();
  if (get().engine === 'none') throw new Error('no-ai');
  if (get().engine === 'instant') throw new Error('no-ai');
  if (get().engine === 'browser' || get().phase === 'ready') return;
  if (loading) return loading.promise;
  const engine = get().engine as ModelId, model = modelOf(engine);
  if (model.runs === 'gpu' ? !get().webgpu : !get().cpu) { set({ phase: 'unsupported' }); throw new Error('no-webgpu'); }
  if (!get().stored) {
    const { quota = 0, usage = 0 } = await navigator.storage?.estimate?.().catch(() => ({})) as { quota?: number; usage?: number } ?? {};
    if (quota && quota - usage < model.bytes * (1.1 - get().share)) { set({ phase: 'failed', error: 'space' }); throw new Error('space'); }
  }
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => undefined);
  loading = { promise, resolve, reject };
  set({ phase: 'loading', error: '', loaded: 0, total: model.bytes });
  // Asks the browser not to throw the model away when space gets tight.
  void navigator.storage?.persist?.().catch(() => false);
  lastSign = Date.now();
  window.clearInterval(watch);
  watch = window.setInterval(() => {
    const quiet = Date.now() - lastSign;
    if (get().phase === 'loading' && quiet > STUCK_LOADING_MS) failCurrent('network: loading got stuck');
    else if (get().phase === 'preparing' && quiet > STUCK_STARTING_MS[model.runs]) failCurrent('memory: starting got stuck');
  }, 5000);
  if (model.runs === 'cpu') { void loadSmall(model); return promise; }
  worker ??= startWorker(engine);
  workerModel = engine;
  worker.postMessage({ type: 'load', model: engine } satisfies ToWorker);
  return promise;
}

export function cancelLoading(): void {
  if (!loading) return;
  const { reject } = loading;
  loading = null;
  stopWorker('cancelled');
  stopSmall();
  reject(new Error('cancelled'));
  set({ phase: 'off', error: '' });
}

/** Deletes the chosen model from this browser, or all of them when none is chosen. */
export async function removeLocalAi(): Promise<void> {
  cancelLoading();
  const { engine } = get();
  for (const id of isModel(engine) ? [engine] : MODEL_IDS) {
    if (id === smallModel) stopSmall();
    if (id === workerModel) stopWorker('removed');
    try { await caches.delete(MODELS[id].cache); } catch { /* nothing stored */ }
    await look(id);
  }
  set({ error: '', ...standing(engine) });
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
  if (onCpu(get().engine)) return askSmall(messages, onText, maxTokens, temperature);
  if (!worker) throw new Error('not-loaded');
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { onText, resolve, reject, text: '' });
    worker!.postMessage({ type: 'generate', id, messages, maxTokens, temperature } satisfies ToWorker);
  });
}

export function stopGenerating(): void {
  browserAbort?.abort();
  if (small && smallAbort) { stopSmall(); if (onCpu(get().engine)) set({ phase: 'off' }); }
  worker?.postMessage({ type: 'stop' } satisfies ToWorker);
}
