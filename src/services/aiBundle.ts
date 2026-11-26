/* LocalDeck bundle: a plain-text way for any AI chat to hand over a complete multi-file project.
   Many AI chats cannot attach a downloadable ZIP, but every one of them can write text. The AI writes each
   file between markers; LocalDeck parses the answer and builds the real ZIP locally. */
import { mimeType, normalizePackagePath } from './zip.ts';

export type BundleFile = { path: string; blob: Blob };

const START = /^[ \t>*_`#-]*===\s*LOCALDECK FILE:\s*(.+?)\s*(\(base64\))?\s*===[ \t*_`]*$/i;
const END = /^[ \t>*_`#-]*===\s*END FILE\s*===[ \t*_`]*$/i;

/** The exact output format, embedded in every prompt LocalDeck generates. */
export const BUNDLE_FORMAT = `OUTPUT FORMAT (required, so LocalDeck can build the ZIP for me)
If you can create downloadable files, ALSO attach the finished ZIP. Either way, write every file of the project in your answer using exactly this text format:

=== LOCALDECK FILE: index.html ===
(complete file content, nothing omitted)
=== END FILE ===

=== LOCALDECK FILE: localdeck.json ===
{ "schemaVersion": 1, "title": "…", "type": "…", "description": "…", "entry": "index.html", "cover": "cover.svg", "tags": ["…"] }
=== END FILE ===

=== LOCALDECK FILE: cover.svg ===
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 750">…an original, colorful cover illustration…</svg>
=== END FILE ===

Rules for the format:
- One block per file, paths relative to the project root (for example assets/logo.svg). Never use "…" or "rest unchanged": every file must be complete.
- Text files (HTML, CSS, JS, JSON, SVG) go in as plain text. For a raster image, write its marker as "=== LOCALDECK FILE: images/photo.png (base64) ===" and put only the base64 data inside.
- Prefer SVG for illustrations and the cover so everything stays text.
- Do not wrap the blocks in code fences, and do not add commentary inside a block.`;

function stripFence(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  if (lines[0]?.trim().startsWith('```') && lines[lines.length - 1]?.trim() === '```') { lines.shift(); lines.pop(); }
  return lines.join('\n');
}

function base64ToBlob(data: string, path: string): Blob {
  const clean = data.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType(path) });
}

/** Parses an AI answer. Supports the LocalDeck markers and, as a fallback, "filename" + fenced code blocks. */
export function parseBundle(answer: string): { files: BundleFile[]; warnings: string[] } {
  const files = new Map<string, BundleFile>();
  const warnings: string[] = [];
  const add = (rawPath: string, content: string, base64: boolean) => {
    let path: string;
    try { path = normalizePackagePath(rawPath.trim().replace(/^[`'"*]+|[`'"*:]+$/g, '').replace(/^\.\//, '')); }
    catch { warnings.push(`Skipped a file with an unsafe name: ${rawPath}`); return; }
    try { files.set(path.toLowerCase(), { path, blob: base64 ? base64ToBlob(content, path) : new Blob([stripFence(content)], { type: mimeType(path) }) }); }
    catch { warnings.push(`${path} is marked as base64 but could not be decoded.`); }
  };

  const lines = answer.replace(/\r\n/g, '\n').split('\n');
  let current: { path: string; base64: boolean; body: string[] } | null = null;
  let sawMarkers = false;
  for (const line of lines) {
    const start = line.match(START);
    if (start) {
      sawMarkers = true;
      if (current) { warnings.push(`${current.path} had no END FILE marker; it was closed automatically.`); add(current.path, current.body.join('\n'), current.base64); }
      current = { path: start[1]!, base64: Boolean(start[2]), body: [] };
      continue;
    }
    if (current && END.test(line)) { add(current.path, current.body.join('\n'), current.base64); current = null; continue; }
    if (current) current.body.push(line);
  }
  if (current) { warnings.push(`${current.path} had no END FILE marker; it was closed automatically.`); add(current.path, current.body.join('\n'), current.base64); }

  if (!files.size && !sawMarkers) {
    // Fallback: "**index.html**" or "`style.css`:" on its own line, followed by a fenced block.
    const fenced = /(?:^|\n)[#>*\s`]*([\w./-]+\.[a-z0-9]{1,6})[`*:\s]*\n```[\w+-]*\n([\s\S]*?)\n```/gi;
    for (const match of answer.matchAll(fenced)) add(match[1]!, match[2]!, false);
    if (files.size) warnings.push('The answer did not use the LocalDeck file markers, so files were read from its code blocks. Check that nothing is missing.');
    else {
      const html = answer.match(/<!doctype html[\s\S]*<\/html>/i)?.[0];
      if (html) { add('index.html', html, false); warnings.push('Only a single HTML page was found in the answer.'); }
    }
  }
  return { files: [...files.values()], warnings };
}

export type PromptKind = 'game' | 'learning' | 'quiz' | 'app' | 'tool' | 'simulation' | 'presentation' | 'other';

/** A complete prompt for an outside AI that ends in a LocalDeck-ready project. */
export function buildProjectPrompt(opts: { idea: string; kind: PromptKind; title?: string; subject?: string; language?: string }): string {
  const kindText: Record<PromptKind, string> = {
    game: 'a polished browser game (keyboard and touch controls, start screen, score, restart)',
    learning: 'an interactive learning sheet (Lernzettel) with clear explanations, examples and self-check exercises',
    quiz: 'an interactive quiz with instant feedback, explanations and a final score',
    app: 'a small, useful web app with a clean interface',
    tool: 'a focused tool that does one job very well',
    simulation: 'an interactive simulation with adjustable parameters and a live visualisation',
    presentation: 'a slide presentation with keyboard and swipe navigation and a progress bar',
    other: 'an interactive HTML project',
  };
  return `Build ${kindText[opts.kind]} for my offline library app LocalDeck.

PROJECT
- Idea: ${opts.idea.trim() || '(describe the project here)'}
${opts.title?.trim() ? `- Title: ${opts.title.trim()}\n` : ''}${opts.subject?.trim() ? `- Subject / category: ${opts.subject.trim()}\n` : ''}${opts.language?.trim() ? `- Language of all visible text: ${opts.language.trim()}\n` : ''}
REQUIREMENTS
- Everything must work offline from local files. No CDNs, remote fonts, analytics, external APIs or server code.
- index.html is the entry page. Split CSS and JS into separate files only if it helps; keep paths relative.
- Make it look great: modern layout, smooth but subtle animations, responsive from phone to desktop, readable contrast, and respect prefers-reduced-motion.
- Include localdeck.json with schemaVersion 1, title, type ("${opts.kind}"), description, entry "index.html", cover, tags${opts.subject?.trim() ? ', subject' : ''}.
- Create an original cover illustration as cover.svg (1200×750) that matches the project. No text other than the title.
- localStorage works for scores and settings (up to 5 MB, kept on the device). IndexedDB does not.

${BUNDLE_FORMAT}`;
}
