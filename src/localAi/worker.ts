/* Runs the local language model. Lives in its own thread, so the page stays responsive. */
import { AutoModelForCausalLM, AutoTokenizer, env, InterruptableStoppingCriteria, TextStreamer } from '@huggingface/transformers';
import ortModule from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { MODEL, type FromWorker, type ToWorker } from './model';

// Runtime files come from LocalDeck itself. Only the model is loaded from Hugging Face, once, in a fixed version.
env.allowLocalModels = false;
env.cacheKey = MODEL.cache;
const absolute = (url: string) => new URL(url, self.location.href).href;
if (env.backends.onnx.wasm) { env.backends.onnx.wasm.wasmPaths = { mjs: absolute(ortModule), wasm: absolute(ortWasm) }; env.backends.onnx.wasm.numThreads = 1; }

type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Model = Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;
let tokenizer: Tokenizer | null = null;
let model: Model | null = null;
const stop = new InterruptableStoppingCriteria();
const send = (message: FromWorker) => self.postMessage(message);
const explain = (error: unknown) => error instanceof Error ? error.message : String(error);

async function load(): Promise<void> {
  if (model) { send({ type: 'ready' }); return; }
  const files = new Map<string, { loaded: number; total: number }>();
  let last = 0;
  const progress_callback = (info: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (info.status !== 'progress' || !info.file || !info.total) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
    if (Date.now() - last < 150) return;
    last = Date.now();
    const loaded = [...files.values()].reduce((sum, file) => sum + file.loaded, 0);
    send({ type: 'progress', loaded, total: Math.max(MODEL.bytes, [...files.values()].reduce((sum, file) => sum + file.total, 0)) });
  };
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }).gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) throw new Error('no-webgpu');
  const options = { revision: MODEL.revision, progress_callback };
  tokenizer = await AutoTokenizer.from_pretrained(MODEL.id, options as never);
  model = await AutoModelForCausalLM.from_pretrained(MODEL.id, { ...options, device: 'webgpu', dtype: adapter.features.has('shader-f16') ? 'q4f16' : 'q4' } as never);
  send({ type: 'preparing' });
  // The first run compiles the GPU programs.
  await (model as unknown as { generate(input: object): Promise<unknown> }).generate({ ...tokenizer('a') as object, max_new_tokens: 1 });
  send({ type: 'ready' });
}

async function generate(message: Extract<ToWorker, { type: 'generate' }>): Promise<void> {
  if (!model || !tokenizer) throw new Error('not-loaded');
  stop.reset();
  const inputs = tokenizer.apply_chat_template(message.messages as never, { add_generation_prompt: true, return_dict: true, enable_thinking: false } as never) as object;
  let text = '';
  const streamer = new TextStreamer(tokenizer as never, { skip_prompt: true, skip_special_tokens: true, callback_function: (part: string) => { text += part; send({ type: 'token', id: message.id, text: part }); } });
  await (model as unknown as { generate(input: object): Promise<unknown> }).generate({ ...inputs, max_new_tokens: message.maxTokens, ...(message.temperature > 0 ? { do_sample: true, temperature: message.temperature, top_p: .9, top_k: 40 } : { do_sample: false }), repetition_penalty: 1.05, streamer, stopping_criteria: stop });
  send({ type: 'done', id: message.id, text });
}

// One request at a time: the GPU session cannot run two.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'stop') { stop.interrupt(); return; }
  queue = queue.then(async () => {
    try { if (message.type === 'load') await load(); else await generate(message); }
    catch (error) { send({ type: 'failed', id: message.type === 'generate' ? message.id : null, error: explain(error) }); }
  });
};
