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
import { createItem, deleteItem, getSettings, setSettings } from '../services/library';
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
  const present = new Set((await db.items.bulkGet(existing)).filter(Boolean).map(item => item!.originalFilename));
  const ids = existing.filter(Boolean);
  let added = 0;
  for (const demo of DEMO_FILES) {
    if (present.has(demo.file)) continue;
    const [preview] = await analyzeFiles([new File([demo.html], demo.file, { type: 'text/html' })]);
    if (!preview) continue;
    const item = await createItem(preview);
    ids.push(item.id);
    added++;
  }
  await setSettings(KEY, ids);
  return added;
}

/** Removes the demo projects that were added by installDemos. Projects the user imported stay. */
export async function removeDemos(): Promise<number> {
  const ids = await getSettings<string[]>(KEY, []);
  let removed = 0;
  for (const id of ids) { if (await db.items.get(id)) { await deleteItem(id); removed++; } }
  await setSettings(KEY, []);
  return removed;
}
