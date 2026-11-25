/* The models to choose from. All of them may be used, changed and passed on by everyone, also commercially: they have
   the Apache 2.0 license (docs/LICENSES.md). LocalDeck does not pass them on, the browser loads them from Hugging Face.
   Every one has a fixed version, so the files can never change without a new version of LocalDeck. */
export type ModelId = 'small' | 'euro' | 'large' | 'qwen' | 'smol';
type Common = { id: ModelId; name: string; license: 'Apache 2.0'; page: string; revision: string; cache: string; bytes: number };
/** Runs on the processor of every device (small.ts). `think`: it thinks first unless it is told that it is done. */
export type CpuModel = Common & { runs: 'cpu'; url: string; think: boolean };
/** Runs on the graphics chip (worker.ts). `plain`: answers plain questions well, but not a form with several lines. */
export type GpuModel = Common & { runs: 'gpu'; repo: string; plain?: boolean };
export type ModelInfo = CpuModel | GpuModel;

const HUB = 'https://huggingface.co/';
export const MODELS: Record<ModelId, ModelInfo> = {
  small: {
    id: 'small', runs: 'cpu', name: 'Qwen3 0.6B', license: 'Apache 2.0', page: `${HUB}Qwen/Qwen3-0.6B`, think: true,
    url: `${HUB}unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf`,
    revision: '50968a4468ef4233ed78cd7c3de230dd1d61a56b', cache: 'localdeck-ai-small', bytes: 396_705_472,
  },
  euro: {
    id: 'euro', runs: 'cpu', name: 'EuroLLM 1.7B', license: 'Apache 2.0', page: `${HUB}utter-project/EuroLLM-1.7B-Instruct`, think: false,
    url: `${HUB}mradermacher/EuroLLM-1.7B-Instruct-GGUF/resolve/2951f08f66429c934c8b01a94347161362430808/EuroLLM-1.7B-Instruct.Q4_K_M.gguf`,
    revision: '2951f08f66429c934c8b01a94347161362430808', cache: 'localdeck-ai-euro', bytes: 1_045_157_088,
  },
  large: {
    id: 'large', runs: 'cpu', name: 'Qwen3 1.7B', license: 'Apache 2.0', page: `${HUB}Qwen/Qwen3-1.7B`, think: true,
    url: `${HUB}unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf`,
    revision: 'd7f544eead698dbd1f15126ef60b45a1e1933222', cache: 'localdeck-ai-large', bytes: 1_107_409_472,
  },
  qwen: {
    id: 'qwen', runs: 'gpu', name: 'Qwen3.5 0.8B', license: 'Apache 2.0', page: `${HUB}Qwen/Qwen3.5-0.8B`,
    repo: 'onnx-community/Qwen3.5-0.8B-Text-ONNX',
    revision: '25cdf33f386b487a25f3d743e86442517bdb77ff', cache: 'localdeck-ai-model', bytes: 489_000_000,
  },
  smol: {
    id: 'smol', runs: 'gpu', name: 'SmolLM3 3B', license: 'Apache 2.0', page: `${HUB}HuggingFaceTB/SmolLM3-3B`,
    repo: 'HuggingFaceTB/SmolLM3-3B-ONNX', plain: true,
    revision: '583cadea149c60c0a737786f61ace5775e165d99', cache: 'localdeck-ai-smol', bytes: 2_136_300_000,
  },
};
export const MODEL_IDS = Object.keys(MODELS) as ModelId[];

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ToWorker = { type: 'load'; model: ModelId } | { type: 'generate'; id: number; messages: ChatMessage[]; maxTokens: number; temperature: number } | { type: 'stop' };
export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'preparing' }
  | { type: 'ready' }
  | { type: 'token'; id: number; text: string }
  | { type: 'done'; id: number; text: string }
  | { type: 'failed'; id: number | null; error: string };
