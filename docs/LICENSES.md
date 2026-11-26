# Licenses of what LocalDeck uses

Everything below is made by others. It may be used for free, also commercially, and may be passed on. Passing it on yourself means keeping the license text and the copyright notice with it.

## AI models

LocalDeck does not pass the models on. The browser of the person loads them from Hugging Face, in a fixed version ([`src/localAi/model.ts`](../src/localAi/model.ts)). A test makes sure that only models with the Apache 2.0 license are in the list.

| Model | Made by | License | Runs on |
|---|---|---|---|
| [Qwen3 0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) | Alibaba Cloud (Qwen) | Apache 2.0 | Processor |
| [Qwen3 1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) | Alibaba Cloud (Qwen) | Apache 2.0 | Processor |
| [EuroLLM 1.7B Instruct](https://huggingface.co/utter-project/EuroLLM-1.7B-Instruct) | UTTER project | Apache 2.0 | Processor |
| [Qwen3.5 0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) | Alibaba Cloud (Qwen) | Apache 2.0 | Graphics chip |
| [SmolLM3 3B](https://huggingface.co/HuggingFaceTB/SmolLM3-3B) | Hugging Face | Apache 2.0 | Graphics chip |

Left out because of their licenses: Gemma (own terms of use) and LFM2.5 (not free above 10 million dollars of revenue). Tried and left out for other reasons: Granite 4.0 (wrong output in the browser), Qwen3.5 2B (45 seconds per answer), SmolLM2 (hardly any German).

The files of the models for the processor were converted to GGUF by Unsloth (Qwen3) and mradermacher (EuroLLM), under the license of the model.

## Software in the website

| Part | License |
|---|---|
| React, Motion, Zustand, Radix UI, React Router, wllama with llama.cpp, ONNX Runtime | MIT |
| Transformers.js, Firebase, Dexie | Apache 2.0 |
| Lucide icons, idb | ISC |
| protobuf.js | BSD 3-Clause |
| Inter (font) | SIL Open Font License 1.1 |

There is no package with a license that would force LocalDeck to publish its own code (GPL, AGPL). Checked with `license-checker` on 25 November 2026. The full texts with the names of the authors are in [`public/licenses.txt`](../public/licenses.txt) (`npm run licenses` writes it anew) and in the app under **Settings → About → Licenses**. LocalDeck itself has its [own license](../LICENSE.md).
