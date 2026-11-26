import { useEffect, useState } from 'react';
import { OPAQUE_SANDBOX, planFrame } from './services/frameSource';
import { getAssets } from './services/library';
import { db } from './services/database';
import { packPage } from './services/packPage';
import { projectPolicy, runtimeScript } from './services/playerRuntime';
import { readProjectSave, writeProjectSave } from './services/projectSaves';
import { formatRoutePath } from './shared';

export type ProjectFrame = { state: 'loading' | 'ready' | 'unavailable'; url: string; sandbox: string | undefined };
const LOADING: ProjectFrame = { state: 'loading', url: '', sandbox: '' };
const MB = 1024 * 1024;

/** Resolves the iframe URL and sandbox for one project file. `version` forces a fresh copy after an edit.
    An HTML page is packed with all its files into one page, because an isolated frame may not load anything from
    LocalDeck (services/packPage). Links to other pages of the project change `path`. */
export function useProjectFrame(itemId: string, startPath: string, version = 0): ProjectFrame {
  const [frame, setFrame] = useState<ProjectFrame>(LOADING);
  const [path, setPath] = useState(startPath);
  useEffect(() => setPath(startPath), [startPath, version]);
  useEffect(() => {
    let active = true, objectUrl = '';
    const token = crypto.randomUUID();
    setFrame(LOADING);
    const unavailable = () => { if (active) setFrame({ state: 'unavailable', url: '', sandbox: '' }); };
    const show = (blob: Blob, sandbox: string | undefined) => { objectUrl = URL.createObjectURL(blob); setFrame({ state: 'ready', url: objectUrl, sandbox }); };
    // Only the page shown now can save or change the page. Its token is new every time.
    const receive = (event: MessageEvent) => {
      const message = event.data as { localdeck?: unknown; token?: unknown; local?: unknown; cookies?: unknown; path?: unknown } | null;
      if (!message || message.token !== token) return;
      if (message.localdeck === 'save') void writeProjectSave(itemId, message.local, message.cookies);
      if (message.localdeck === 'open' && typeof message.path === 'string') {
        const next = message.path;
        void getAssets(itemId).then(assets => { const found = assets.find(entry => entry.normalizedPath.toLowerCase() === next.toLowerCase() || entry.normalizedPath.toLowerCase() === `${next}/index.html`.replace(/^\//, '').toLowerCase()); if (active && found && /\.html?$/i.test(found.normalizedPath)) setPath(found.normalizedPath); });
      }
    };
    window.addEventListener('message', receive);
    void (async () => {
      const assets = await getAssets(itemId);
      if (!active) return;
      const asset = assets.find(entry => entry.normalizedPath === path);
      const plan = planFrame(path, assets.map(entry => entry.normalizedPath), Boolean(navigator.serviceWorker?.controller));
      if (!asset || plan.kind === 'unavailable') { unavailable(); return; }
      if (plan.kind === 'routed') { setFrame({ state: 'ready', url: formatRoutePath(itemId, path), sandbox: plan.sandbox }); return; }
      if (plan.kind === 'blob') { show(new Blob([asset.blob], { type: plan.mime }), plan.sandbox); return; }
      const [item, saved] = await Promise.all([db.items.get(itemId), readProjectSave(itemId)]);
      const html = await packPage(assets.map(entry => ({ path: entry.normalizedPath, blob: entry.blob })), path, {
        policy: projectPolicy(item?.runtimeSettings.internet === true),
        prelude: (named, folder) => runtimeScript({ local: saved?.local ?? {}, cookies: saved?.cookies ?? '' }, token, named, folder),
        maxFile: 60 * MB, maxTotal: 160 * MB, named: () => true,
      });
      if (active) show(new Blob([html], { type: 'text/html' }), OPAQUE_SANDBOX);
    })().catch(unavailable);
    return () => { active = false; window.removeEventListener('message', receive); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [itemId, path, version]);
  return frame;
}
