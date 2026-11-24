/* What an AI needs to know: how LocalDeck works, what the AI studio asks for and how a project has to look.
   `checkProject` looks at a project the way LocalDeck will run it and names the problems. */
import { buildProjectPrompt, BUNDLE_FORMAT, type PromptKind } from '../../../src/services/aiBundle.ts';

export const TOPICS = ['website', 'ai_studio', 'output', 'design', 'types'] as const;
export type Topic = typeof TOPICS[number];
export type GuideLimits = { projectMiB: number; files: number; requestMiB: number; callsPerHour: number; changesPerDay: number; days: number };

const WEBSITE = `HOW LOCALDECK WORKS
LocalDeck is a website and installable app (phone, tablet, computer). It keeps HTML projects in the person's own browser (IndexedDB), without a server. Nothing is uploaded unless the person shares a project.

Pages
- Home: recently opened and favorite projects.
- Library: all projects, with search (title, subject, topic, description, hashtags), filters by type and sorting.
- Learning: types learning, quiz, presentation and document, grouped by subject. Give school projects a subject.
- Games & apps: types game, app, tool and simulation.
- Collections: groups the person makes.
- Import: HTML files, ZIP projects, PDFs or folders. Every import is checked on the device: what it is, hashtags, and a hint for content that may be for adults.
- AI studio: package builder (paste an AI answer or files, get a finished ZIP), PDF to project (prompt), improve HTML (inspects a page and writes a prompt).
- Shared links: encrypted links. The key is in the part after "#" and never reaches the server.
- Settings: theme, language (English, German, French, Spanish, Italian), local AI, connect an AI.

What happens with your project
1. create_project stores it encrypted and returns a link.
2. The person opens the link, sees title, type, description and hashtags, and imports it. From then on it works offline.
3. After update_project the same link delivers the new version. A copy that is already imported does not change by itself: the person opens the link again and imports it, or downloads it and uses the update button on the project card.

How a project runs
- In an isolated frame (sandbox with scripts, forms, pointer lock, presentation and downloads).
- Blocked: every request to the internet, localStorage, sessionStorage, IndexedDB, cookies, service workers, alert/confirm/prompt, opening windows, reading the library.
- Allowed: inline scripts and styles, relative files of the project, data: and blob: URLs, canvas, WebGL, Web Audio, fullscreen, downloads of blobs, ES modules with relative paths.
- The window can be a phone (about 360 x 640) or a big screen, in light or dark surroundings.`;

const DESIGN = `HOW TO MAKE IT GOOD
- One clear purpose. The first screen shows what it is and how to start.
- Responsive from 320 px. Tap targets at least 44 px. Games need touch controls as well as keys (arrows and WASD), and a restart.
- Contrast of text at least 4.5:1. Visible keyboard focus. Respect prefers-reduced-motion.
- Add <meta name="viewport" content="width=device-width, initial-scale=1">, <html lang="…"> and a <title>.
- Use system fonts or a font file inside the project. Draw pictures as SVG or canvas. Keep photos small (WebP).
- Quizzes: feedback after every answer, a short explanation, a final score, try again.
- Study sheets: headings, short sections, examples, a self-check at the end. Only facts you are sure about.
- Presentations: arrow keys, swipe, a progress bar, readable from a distance.
- Simulations: sliders with units, live drawing, reset.
- Keep state in memory. Do not ask for personal data or passwords.
- If content is not suitable for children, say so in the description and add the hashtag 18plus or 16plus. LocalDeck shows a warning.
- cover.svg, 1200 x 750, original, colorful, without text except the title.`;

const TYPES = `TYPES
game: something to play. learning: study sheet or explanation. quiz: questions with feedback. simulation: adjustable model. presentation: slides. tool: one job, such as a calculator or timer. app: larger helper. other: anything else.
DETAILS
title: 2 to 5 words, specific ("Photosynthesis quiz", not "Quiz"). subject: school subject or category. topic: the exact topic. description: one or two sentences. tags: 3 to 6 hashtags, single words without #, in the person's language. language: code such as de.`;

function output(limits: GuideLimits): string {
  return `HOW TO OUTPUT
With these tools: call create_project with title, type, subject, topic, description, tags, language and files. index.html is required. localdeck.json is written for you from the details. Then give the person the complete link, including everything after "#".

Large projects: create index.html first, then add the other files with update_project in several calls. One call may carry up to ${limits.requestMiB} MiB, the whole project ${limits.projectMiB} MiB and ${limits.files} files.
Changes: read_project for the list of files, read_project with path for the content, then update_project with "edits" (find must appear exactly once). Several edits fit in one call. Only send whole files again when most of a file changes.
Images and other binary files: encoding "base64".
After every change LocalDeck answers with a list of problems if it finds any. Fix them and update again. check_project repeats that check at any time.

Limits of this connection: ${limits.projectMiB} MiB and ${limits.files} files per project, ${limits.callsPerHour} calls per hour, ${limits.changesPerDay} changes per day. A link stays online for ${limits.days} days after the last change.

Without these tools (a chat that only writes text) the person pastes your answer into AI studio, Package builder. It must look like this:

${BUNDLE_FORMAT}`;
}

const KINDS: PromptKind[] = ['game', 'learning', 'quiz', 'app', 'tool', 'simulation', 'presentation', 'other'];

export function guide(topic: string | undefined, input: Record<string, unknown>, limits: GuideLimits): string {
  switch (topic) {
    case 'website': return WEBSITE;
    case 'design': return DESIGN;
    case 'types': return TYPES;
    case 'output': return output(limits);
    case 'ai_studio': {
      const text = (key: string) => typeof input[key] === 'string' ? (input[key] as string).slice(0, 2000) : '';
      const kind = KINDS.find(entry => entry === input.kind) ?? 'other';
      return `This is the request AI studio writes for the chosen kind of project. With these tools, follow its REQUIREMENTS and send the files through create_project instead of writing text blocks. localdeck.json is not needed then.\n\n${buildProjectPrompt({ idea: text('idea'), kind, title: text('title'), subject: text('subject'), language: text('language') })}`;
    }
    default: return `${WEBSITE}\n\n${TYPES}\n\n${DESIGN}\n\n${output(limits)}`;
  }
}

/* ---------- Check ---------- */

const decoder = new TextDecoder();
const SCAN_BYTES = 200_000, SCAN_TOTAL = 800_000;
const line = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** Problems that a person would notice. Looks at the start of every text file, so it stays quick. */
export function checkProject(files: Map<string, Uint8Array>): string[] {
  const found: string[] = [], paths = new Set([...files.keys()].map(path => path.toLowerCase()));
  let budget = SCAN_TOTAL;
  const add = (path: string, text: string, pattern: RegExp, message: string) => { const match = pattern.exec(text); if (match) found.push(`${path}:${line(text, match.index)} ${message}`); };
  for (const [path, data] of files) {
    if (!/\.(html?|css|m?js|svg)$/i.test(path) || budget <= 0) continue;
    const part = data.subarray(0, Math.min(SCAN_BYTES, budget));
    budget -= part.length;
    const text = decoder.decode(part), script = /\.m?js$/i.test(path), page = /\.html?$/i.test(path), style = /\.css$/i.test(path);
    if (page || /\.svg$/i.test(path)) add(path, text, /<(?:script|link|img|iframe|audio|video|source|embed|image|use)\b[^>]*?\s(?:src|href|xlink:href)\s*=\s*["']?(?:https?:)?\/\//i, 'loads something from the internet. It is blocked, put the file into the project.');
    if (page || style) add(path, text, /@import\s+(?:url\()?["']?(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\//i, 'loads a style, font or image from the internet. It is blocked.');
    if (page || script) {
      add(path, text, /\bfetch\(\s*["'`]https?:|new\s+WebSocket\(|new\s+EventSource\(|importScripts\(\s*["']https?:|from\s+["']https?:/i, 'contacts the internet. It is blocked.');
      add(path, text, /\b(?:localStorage|sessionStorage|indexedDB)\s*[.[]|document\.cookie/, 'uses browser storage. It is not available and throws an error. Keep state in memory or use try/catch.');
      add(path, text, /(?<![.\w])(?:alert|confirm|prompt)\(/, 'uses alert, confirm or prompt. They do nothing here, show the message in the page.');
      add(path, text, /serviceWorker\.register/, 'registers a service worker. It is not available.');
    }
    if (page) {
      if (!/<meta[^>]+name\s*=\s*["']?viewport/i.test(text)) found.push(`${path} has no viewport meta tag, so it looks tiny on phones.`);
      if (!/<html[^>]+lang\s*=/i.test(text)) found.push(`${path} has no lang attribute on <html>.`);
      if (/<input[^>]+type\s*=\s*["']?password/i.test(text)) found.push(`${path} asks for a password. Projects must not collect passwords.`);
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
      for (const match of text.matchAll(/<(?:script|link|img|audio|video|source|iframe)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"'#?]+)/gi)) {
        const target = match[1]!.trim();
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)|[${]/i.test(target)) continue;
        if (target.startsWith('/')) { found.push(`${path}:${line(text, match.index)} "${target}" starts with "/". Use a relative path.`); continue; }
        const parts: string[] = [];
        for (const piece of (folder + target).split('/')) { if (piece === '..') parts.pop(); else if (piece && piece !== '.') parts.push(piece); }
        if (!paths.has(parts.join('/').toLowerCase())) found.push(`${path}:${line(text, match.index)} "${target}" is not in the project.`);
      }
    }
  }
  if (!['cover.svg', 'cover.png', 'cover.webp', 'cover.jpg'].some(path => paths.has(path))) found.push('There is no cover. Add cover.svg (1200 x 750).');
  return [...new Set(found)].slice(0, 20);
}
