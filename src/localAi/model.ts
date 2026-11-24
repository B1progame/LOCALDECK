export const MODEL = {
  name: 'Qwen3.5 0.8B',
  id: 'onnx-community/Qwen3.5-0.8B-Text-ONNX',
  /** A fixed version, so the files can never change without a new version of LocalDeck. */
  revision: '25cdf33f386b487a25f3d743e86442517bdb77ff',
  cache: 'localdeck-ai-model',
  bytes: 489_000_000,
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ToWorker = { type: 'load' } | { type: 'generate'; id: number; messages: ChatMessage[]; maxTokens: number; temperature: number } | { type: 'stop' };
export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'preparing' }
  | { type: 'ready' }
  | { type: 'token'; id: number; text: string }
  | { type: 'done'; id: number; text: string }
  | { type: 'failed'; id: number | null; error: string };
