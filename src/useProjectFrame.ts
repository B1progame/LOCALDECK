import { useEffect, useState } from 'react';
import { planFrame } from './services/frameSource';
import { getAssets } from './services/library';
import { formatRoutePath } from './shared';

export type ProjectFrame = { state: 'loading' | 'ready' | 'unavailable'; url: string; sandbox: string | undefined };
const LOADING: ProjectFrame = { state: 'loading', url: '', sandbox: '' };

/** Resolves the iframe URL and sandbox for one project file. `version` forces a fresh copy after an edit. */
export function useProjectFrame(itemId: string, path: string, version = 0): ProjectFrame {
  const [frame, setFrame] = useState<ProjectFrame>(LOADING);
  useEffect(() => {
    let active = true, objectUrl = '';
    setFrame(LOADING);
    const unavailable = () => { if (active) setFrame({ state: 'unavailable', url: '', sandbox: '' }); };
    void getAssets(itemId).then(assets => {
      if (!active) return;
      const asset = assets.find(entry => entry.normalizedPath === path);
      const plan = planFrame(path, assets.map(entry => entry.normalizedPath), Boolean(navigator.serviceWorker?.controller));
      if (!asset || plan.kind === 'unavailable') { unavailable(); return; }
      if (plan.kind === 'routed') { setFrame({ state: 'ready', url: formatRoutePath(itemId, path), sandbox: plan.sandbox }); return; }
      objectUrl = URL.createObjectURL(new Blob([asset.blob], { type: plan.mime }));
      setFrame({ state: 'ready', url: objectUrl, sandbox: plan.sandbox });
    }).catch(unavailable);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [itemId, path, version]);
  return frame;
}
