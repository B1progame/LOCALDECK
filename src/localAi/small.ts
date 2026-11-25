/* Runs a small language model with the processor alone. It needs no graphics chip and no WebGPU, only plain
   WebAssembly, so it works in Safari, Firefox and Chrome on computers, phones and tablets. It is slow and uses as
   little memory as possible. The model files stay on the disk of the browser and are read from there. */
import { LoggerWithoutDebug, Wllama } from '@wllama/wllama';
import wasm from '@wllama/wllama/esm/single-thread/wllama.wasm?url';
import { SMALL, type ChatMessage } from './model';
import { loadBlobs, type PartCache } from './parts';

/** Room for the text and the answer, in word pieces. More would need more memory. */
const CONTEXT = 1024;

export type SmallModel = {
  generate: (messages: ChatMessage[], onText: (text: string) => void, options: { maxTokens: number; temperature: number; signal: AbortSignal }) => Promise<string>;
  close: () => void;
};

/** The text of a project must not be able to look like a part of the conversation. */
const plain = (text: string) => text.replace(/<\|/g, '< |');
const prompt = (messages: ChatMessage[]) => `${messages.map(message => `<|im_start|>${message.role}\n${plain(message.content)}<|im_end|>\n`).join('')}<|im_start|>assistant\n<think>\n\n</think>\n\n`;

export async function startSmall(options: { signal: AbortSignal; onProgress: (loaded: number, total: number) => void; onStarting: () => void }): Promise<SmallModel> {
  let cache: PartCache | null = null;
  try { cache = await caches.open(SMALL.cache); } catch { /* private window: works, but loads again next time */ }
  const blobs = await loadBlobs(SMALL.url, { cache, signal: options.signal, onProgress: options.onProgress });
  options.onStarting();
  const runner = new Wllama({ 'single-thread/wllama.wasm': new URL(wasm, location.href).href }, { suppressNativeLog: true, logger: LoggerWithoutDebug });
  const close = () => { void runner.exit().catch(() => undefined); };
  try {
    await runner.loadModel([new Blob(blobs)], { n_ctx: CONTEXT, n_batch: 128, n_threads: 1, flash_attn: true, cache_type_k: 'q8_0', cache_type_v: 'q8_0' });
    if (options.signal.aborted) throw new Error('cancelled');
  } catch (error) { close(); throw error; }
  return {
    close,
    async generate(messages, onText, { maxTokens, temperature, signal }) {
      const text = prompt(messages);
      if ((await runner.tokenize(text, true)).length + maxTokens + 8 > CONTEXT) throw new Error('too-long');
      return (await runner.createCompletion(text, {
        nPredict: maxTokens, useCache: true, abortSignal: signal, sampling: { temp: temperature, top_p: .9, top_k: 40, penalty_repeat: 1.05 },
        onNewToken: (_token, _piece, current) => onText(current),
      })).trim();
    },
  };
}
