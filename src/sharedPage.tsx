/* Opens an encrypted share link: checks it, downloads it, decrypts it in this browser. */
import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, Info, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { analyzeFiles } from './services/importer';
import { createItem } from './services/library';
import { fetchShare, parseSharedRoute, shareProblem, type ShareProblem } from './services/shareLink';
import { decryptSharePackage } from './services/sharing';
import { createStoredZip } from './services/zip';
import type { ImportPreview } from './types';
import { PageHeading, PreviewIcon, TYPE_LABEL, bytes, friendlyDate, go } from './shared';

const DEFAULT_API = import.meta.env.VITE_SHARE_API_BASE ?? '';

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

type State =
  | { kind: 'loading'; message: string }
  | { kind: 'ready'; preview: ImportPreview; expires: string }
  | { kind: 'problem'; problem: ShareProblem; needsApi?: boolean };

const LOADING: State = { kind: 'loading', message: 'Checking this shared project…' };
const asMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export function SharedPage({ hash, notify }: { hash: string; notify: (message: string, error?: boolean) => void }) {
  const [state, setState] = useState<State>(LOADING);
  const [api, setApi] = useState(DEFAULT_API);
  const [apiDraft, setApiDraft] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const show = (next: State) => { if (active) setState(next); };
    const fail = (problem: ShareProblem, needsApi = false) => show({ kind: 'problem', problem, needsApi });
    const { id, key } = parseSharedRoute(hash);
    setState(LOADING);
    if (!id || !key) {
      fail({ title: 'This link is incomplete', message: id ? 'The secret part at the end of the link is missing. Ask for the complete link again.' : 'Part of the link was lost when it was copied. Ask for the complete link again.', retry: false });
      return;
    }
    if (!api) {
      fail({ title: 'Sharing is not connected', message: 'This LocalDeck was built without a sharing service. Enter the address of the service that created the link.', retry: false }, true);
      return;
    }
    void (async () => {
      const url = `${api.replace(/\/$/, '')}/api/v1/shares/${id}`;
      const meta = await fetchShare(url);
      if (!active) return;
      if (!meta.response?.ok) { fail(shareProblem(meta.status)); return; }
      const { expiresAt } = await meta.response.json() as { expiresAt: string };
      show({ kind: 'loading', message: 'Downloading the encrypted project…' });
      const blob = await fetchShare(`${url}/blob`, undefined, 1500, true);
      if (!active) return;
      if (!blob.response?.ok) {
        fail(blob.status === 404 ? { title: 'The project is still on its way', message: 'A new share can take up to a minute to reach every location. Try again shortly.', retry: true } : shareProblem(blob.status));
        return;
      }
      const encrypted = await blob.response.arrayBuffer();
      show({ kind: 'loading', message: 'Decrypting it on this device…' });
      const clear = await decryptSharePackage(encrypted, key);
      const previews = await analyzeFiles([new File([clear], `shared-${id}.zip`, { type: 'application/zip' })]);
      if (previews.length !== 1) throw new Error('The shared archive does not contain a valid project.');
      show({ kind: 'ready', preview: previews[0]!, expires: friendlyDate(Date.parse(expiresAt)) });
    })().catch(error => fail({ title: 'This share could not be opened', message: asMessage(error), retry: true }));
    return () => { active = false; };
  }, [api, hash, attempt]);

  const importShared = async (preview: ImportPreview) => {
    try { await createItem(preview); notify(`“${preview.title}” was imported to this device.`); go('library'); }
    catch (error) { notify(asMessage(error), true); }
  };
  const downloadShared = async (preview: ImportPreview) => {
    try {
      const entries = await Promise.all(preview.files.map(async file => ({ path: file.path, data: new Uint8Array(await file.blob.arrayBuffer()) })));
      downloadBlob(await createStoredZip(entries), `${preview.title.replace(/[^a-z0-9_-]+/gi, '-')}.zip`);
      notify('The share was decrypted and saved as a ZIP file.');
    } catch (error) { notify(asMessage(error), true); }
  };
  const connect = (event: React.FormEvent) => {
    event.preventDefault();
    const next = apiDraft.trim();
    if (!/^https:\/\/\S+$/i.test(next)) { notify('Enter an address that starts with https://', true); return; }
    setApi(next);
  };

  return <>
    <PageHeading eyebrow="Private transfer" title="Shared project" description="The project is decrypted in this browser and stays isolated from your library until you import it."/>
    {state.kind === 'loading' && <div className="shared-state" role="status"><LoaderCircle className="spin" size={24}/><p>{state.message}</p></div>}
    {state.kind === 'ready' && <div className="shared-card">
      <span className="preview-icon"><PreviewIcon type={state.preview.type}/></span>
      <div>
        <div className="eyebrow">{TYPE_LABEL[state.preview.type]} · {bytes(state.preview.storageSize)}</div>
        <h2>{state.preview.title}</h2>
        <p>{state.preview.description || 'A project shared with you.'}</p>
        <small>Link expires {state.expires}</small>
      </div>
      <div className="shared-actions">
        <button className="button primary" onClick={() => void importShared(state.preview)}><Plus size={16}/> Import to my library</button>
        <button className="button" onClick={() => void downloadShared(state.preview)}><ArrowDownToLine size={15}/> Download copy</button>
      </div>
    </div>}
    {state.kind === 'problem' && <div className="shared-error" role="alert">
      <Info size={20}/>
      <h2>{state.problem.title}</h2>
      <p>{state.problem.message}</p>
      <div className="shared-error-actions">
        {state.problem.retry && <button className="button primary" onClick={() => setAttempt(count => count + 1)}><RefreshCw size={15}/> Try again</button>}
        <button className="button" onClick={() => go('home')}>Open my library</button>
      </div>
    </div>}
    {state.kind === 'problem' && state.needsApi && <form className="share-setup panel" onSubmit={connect}>
      <label className="form-field"><span>Sharing service address</span><input type="url" value={apiDraft} onChange={event => setApiDraft(event.target.value)} placeholder="https://your-worker.workers.dev"/></label>
      <button className="button" type="submit">Open the link</button>
    </form>}
  </>;
}
