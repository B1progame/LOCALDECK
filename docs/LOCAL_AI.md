# Local AI

A language model that runs inside the website, on the device of the person using it. It reads projects, explains what they are, adds hashtags and warns about content that may be for adults. No account, no key, no server.

1. **Settings → Local AI**: choose an AI (off by default). Qwen is then loaded once with **Set up the AI**.
2. From then on every import is scanned in the background. The AI fills in only what is missing and adds hashtags. A name is changed only when it says nothing, such as `index`. **Scan every import automatically** in Settings turns this off.
3. A shared link shows what the project is before it is imported.
4. **Scan this project** in the details of a project suggests everything anew. Nothing changes before you press **Save**.
5. **Check the whole library** scans projects that are already there.

## Content check

Every import and every shared link is also checked by rules, without any AI (`src/services/contentCheck.ts`): words in the project, hashtags such as `18plus` or `16plus`, and password fields. The result is nothing, 16+ or 18+. The AI can raise it by one step, and only when the project itself contains a sign for it. It never lowers it. A lesson about a topic is not flagged like the topic itself. An 18+ project asks before it is opened or imported, and **This is fine** removes the mark. Pictures are not looked at and the check can be wrong, so it is a hint and no protection for children.

A click on a hashtag shows all projects with it. `#word` in the search does the same.

## Engines

| Engine | What is loaded | Where it works |
|---|---|---|
| AI of the browser | Nothing. It is used when the browser already has one ready (`LanguageModel`) | Some versions of Chrome and Edge on computers |
| Qwen3.5 0.8B | About 490 MB, once per browser | Browsers with WebGPU and a fairly new graphics chip |

Qwen3.6 has no version this small, so Qwen3.5 0.8B (Apache 2.0) is used: `onnx-community/Qwen3.5-0.8B-Text-ONNX` in a fixed revision, see `src/localAi/model.ts`. Chips without 16-bit shaders load the `q4` files, about 570 MB.

## Good to know

- The model is kept in the browser's cache `localdeck-ai-model` and then works offline. **Delete the model** in Settings removes it. A browser may also remove it when space gets tight.
- The model files come from Hugging Face, which sees the IP address while they load. Projects and suggestions stay on the device.
- The runtime (ONNX Runtime, 27 MB) comes from LocalDeck itself and is loaded on first use. The service worker does not precache it.
- After ten minutes without use the model leaves the memory. Starting it again needs no internet.
- When another program fills the graphics memory, the browser stops the model. LocalDeck shows that and offers to try again.
- A model of this size makes mistakes, so every field can be changed before saving. Clear signs in the page (score, slides, questions) decide the type, not the model.

## Technical

- `src/localAi/worker.ts`: the model in its own thread. `src/localAi/engine.ts`: state and both engines.
- `src/services/projectScan.ts`: collects the visible text of every HTML page and the texts inside scripts (code and styles are left out), cuts it into parts of 4,500 characters and summarizes each part. The last request turns that into the details. Up to 12 parts are read, longer projects at evenly spread places, and the page says so.
- Nothing of the project is executed. Its text is marked as untrusted in every request, and the answer is only used as text.
- `src/autoScan.ts`: the queue, one project at a time. It never starts the large download by itself.
- `src/projectScanPanel.tsx`: the panel on the details page.
- `package.json` replaces `onnxruntime-node` and `sharp` with `vendor/empty`. They are only needed outside the browser and are very large.
