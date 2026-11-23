/* Built-in demo projects. Each is a self-contained offline HTML file with an embedded LocalDeck manifest.
   They are only added to the library when the user turns demos on, and removed again when turned off. */
import neonDrift from './neon-drift.html?raw';
import ableitungen from './ableitungen.html?raw';
import photosynthese from './photosynthese-quiz.html?raw';
import pendulum from './pendulum-lab.html?raw';
import palette from './pixel-palette.html?raw';
import revolution from './franzoesische-revolution.html?raw';
import pomodoro from './pomodoro-focus.html?raw';
import sorting from './sorting-visualizer.html?raw';
import { analyzeFiles } from '../services/importer';
import { createItem, deleteItem, getSettings, replaceItemFiles, setSettings } from '../services/library';
import { db } from '../services/database';

export const DEMO_FILES: Array<{ file: string; html: string }> = [
  { file: 'neon-drift.html', html: neonDrift },
  { file: 'ableitungen-verstehen.html', html: ableitungen },
  { file: 'photosynthese-quiz.html', html: photosynthese },
  { file: 'pendulum-lab.html', html: pendulum },
  { file: 'pixel-palette.html', html: palette },
  { file: 'franzoesische-revolution.html', html: revolution },
  { file: 'pomodoro-focus.html', html: pomodoro },
  { file: 'sorting-visualizer.html', html: sorting },
];

const KEY = 'demo-item-ids';

export async function demosEnabled(): Promise<boolean> {
  const ids = await getSettings<string[]>(KEY, []);
  return ids.length > 0;
}

/** Adds every demo that is not already in the library. Resolves with the number added. */
export async function installDemos(): Promise<number> {
  const existing = await getSettings<string[]>(KEY, []);
  const items = (await db.items.bulkGet(existing)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const byFile = new Map(items.map(item => [item.originalFilename, item]));
  const ids = items.map(item => item.id);
  let added = 0;
  for (const demo of DEMO_FILES) {
    const [preview] = await analyzeFiles([new File([demo.html], demo.file, { type: 'text/html' })]);
    if (!preview) continue;
    const current = byFile.get(demo.file);
    if (current) {
      // Refresh demos whose code changed in a newer LocalDeck version; the user's favorites and collections stay.
      const entry = await db.assets.where('[itemId+normalizedPath]').equals([current.id, current.entryFile]).first();
      if (entry && await entry.blob.text() !== demo.html) await replaceItemFiles(current.id, preview);
      continue;
    }
    const item = await createItem(preview);
    ids.push(item.id);
    added++;
  }
  await setSettings(KEY, ids);
  return added;
}

/** Keeps installed demos up to date. Safe to call on every start. */
export async function syncDemos(): Promise<void> {
  if (await demosEnabled()) await installDemos();
}

/** Removes the demo projects that were added by installDemos. Projects the user imported stay. */
export async function removeDemos(): Promise<number> {
  const ids = await getSettings<string[]>(KEY, []);
  let removed = 0;
  for (const id of ids) { if (await db.items.get(id)) { await deleteItem(id); removed++; } }
  await setSettings(KEY, []);
  return removed;
}
