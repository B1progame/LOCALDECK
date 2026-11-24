/* Opens an encrypted share link: checks it, downloads it, decrypts it in this browser. */
import { t, tm } from './i18n';
import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, Info, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { analyzeFiles } from './services/importer';
import { aiIsReady, askAbout, kindTag, readProjectText, ruleCheck, scanImported, useAutoScan, withAi } from './autoScan';
import { tagsWithMark, useContentMarks } from './contentMarks';
import { ContentNote } from './contentNote';
import { stopGenerating, useLocalAi } from './localAi/engine';
import { withOpinion, type ContentCheck } from './services/contentCheck';
import { createItem } from './services/library';
import { importantTags } from './services/projectScan';
import { fetchShare, parseSharedRoute, shareProblem, type ShareProblem } from './services/shareLink';
import { downloadShare } from './services/shareService';
import { rememberKey } from './services/savedShares';
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

const LOADING: State = { kind: 'loading', message: t('Checking this shared project…') };
const asMessage = (error: unknown) => error instanceof Error ? tm(error.message) : t('Something went wrong. Please try again.');

type Explained = { check: ContentCheck | null; scanning: boolean; summary: string; tags: string[]; subject: string; topic: string };
const NOTHING: Explained = { check: null, scanning: false, summary: '', tags: [], subject: '', topic: '' };

/** Checks a shared project before it is imported: by rules at once, then by the local AI if one is ready. */
function useExplanation(preview: ImportPreview | null): Explained {
  const [state, setState] = useState<Explained>(NOTHING);
  useEffect(() => {
    if (!preview) return;
    let active = true, owns = false;
    setState(NOTHING);
    void (async () => {
      const project = await readProjectText(preview.files, preview.selectedEntry);
      const check = ruleCheck(project, preview);
      if (!active) return;
      setState({ ...NOTHING, check, tags: preview.tags });
      if (!useAutoScan.getState().auto || !await aiIsReady() || !active) return;
      setState(current => ({ ...current, scanning: true }));
      try {
        const result = await withAi(`shared:${preview.id}`, async () => { owns = true; try { return await askAbout(project, preview.sourceName, { cancelled: () => !active, background: true }); } finally { owns = false; } });
        if (active) setState({ check: withOpinion(check, result.found, result.suggestion.description), scanning: false, summary: result.suggestion.description, tags: importantTags(preview.tags, result.suggestion, kindTag(result.suggestion.type || preview.type)), subject: result.suggestion.subject, topic: result.suggestion.topic });
      } catch { if (active) setState(current => ({ ...current, scanning: false })); }
    })().catch(() => undefined);
    return () => { active = false; if (owns) stopGenerating(); };
  }, [preview]);
  return state;
}

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
      fail({ title: t('This link is incomplete'), message: id ? t('The secret part at the end of the link is missing. Ask for the complete link again.') : t('Part of the link was lost when it was copied. Ask for the complete link again.'), retry: false });
      return;
    }
    if (!api) {
      fail({ title: t('Sharing is not connected'), message: t('This LocalDeck was built without a sharing service. Enter the address of the service that created the link.'), retry: false }, true);
      return;
    }
    void (async () => {
      const url = `${api.replace(/\/$/, '')}/api/v1/shares/${id}`;
      const meta = await fetchShare(url);
      if (!active) return;
      if (!meta.response?.ok) { fail(shareProblem(meta.status)); return; }
      const { expiresAt, parts = 1 } = await meta.response.json() as { expiresAt: string; parts?: number };
      show({ kind: 'loading', message: t('Downloading the encrypted project…') });
      const download = await downloadShare(url, parts, value => { if (parts > 1) show({ kind: 'loading', message: t('Downloading the encrypted project: {0}%', Math.round(value * 100)) }); });
      if (!active) return;
      if ('failed' in download) {
        fail(download.failed.status === 404 ? { title: t('The project is still on its way'), message: t('A new share can take up to a minute to reach every location. Try again shortly.'), retry: true } : shareProblem(download.failed.status));
        return;
      }
      show({ kind: 'loading', message: t('Decrypting it on this device…') });
      const clear = await decryptSharePackage(download.data, key);
      const previews = await analyzeFiles([new File([clear], `shared-${id}.zip`, { type: 'application/zip' })]);
      if (previews.length !== 1) throw new Error(t('The shared archive does not contain a valid project.'));
      void rememberKey(id, key, expiresAt).catch(() => undefined);
      show({ kind: 'ready', preview: previews[0]!, expires: friendlyDate(Date.parse(expiresAt)) });
    })().catch(error => fail({ title: t('This share could not be opened'), message: asMessage(error), retry: true }));
    return () => { active = false; };
  }, [api, hash, attempt]);

  const preview = state.kind === 'ready' ? state.preview : null;
  const explained = useExplanation(preview);
  const { engine } = useLocalAi();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => setAllowed(false), [preview]);
  const { on: marks } = useContentMarks();
  const tags = tagsWithMark(explained.tags, explained.check, marks);
  const locked = marks && explained.check?.rating === '18' && !allowed;

  const importShared = async (preview: ImportPreview) => {
    try {
      const item = await createItem({ ...preview, description: preview.description || explained.summary, subject: preview.subject || explained.subject, topic: preview.topic || explained.topic, tags: explained.tags.length ? explained.tags : preview.tags, ...(explained.check ? { contentCheck: explained.check } : {}) });
      void scanImported(item);
      notify(t('“{0}” was imported to this device.', preview.title)); go('library'); }
    catch (error) { notify(asMessage(error), true); }
  };
  const downloadShared = async (preview: ImportPreview) => {
    try {
      const entries = await Promise.all(preview.files.map(async file => ({ path: file.path, data: new Uint8Array(await file.blob.arrayBuffer()) })));
      downloadBlob(await createStoredZip(entries), `${preview.title.replace(/[^a-z0-9_-]+/gi, '-')}.zip`);
      notify(t('The share was decrypted and saved as a ZIP file.'));
    } catch (error) { notify(asMessage(error), true); }
  };
  const connect = (event: React.FormEvent) => {
    event.preventDefault();
    const next = apiDraft.trim();
    if (!/^https:\/\/\S+$/i.test(next)) { notify(t('Enter an address that starts with https://'), true); return; }
    setApi(next);
  };

  return <>
    <PageHeading eyebrow={t('Private transfer')} title={t('Shared project')} description={t('The project is decrypted in this browser and stays isolated from your library until you import it.')}/>
    {state.kind === 'loading' && <div className="shared-state" role="status"><LoaderCircle className="spin" size={24}/><p>{state.message}</p></div>}
    {state.kind === 'ready' && <div className="shared-card">
      <span className="preview-icon"><PreviewIcon type={state.preview.type}/></span>
      <div>
        <div className="eyebrow">{TYPE_LABEL[state.preview.type]} · {bytes(state.preview.storageSize)}</div>
        <h2>{state.preview.title}</h2>
        <p>{state.preview.description || t('A project shared with you.')}</p>
        <small>{t('Link expires {0}', state.expires)}</small>
        {tags.length > 0 && <div className="tag-list">{tags.map(tag => <span key={tag} className={`tag ${tag === '18+' ? 'tag-18' : tag === '16+' ? 'tag-16' : ''}`}>#{tag}</span>)}</div>}
      </div>
      <div className="shared-actions">
        {locked && <button className="button" onClick={() => setAllowed(true)}>{t('I am old enough, continue')}</button>}
        <button className="button primary" disabled={locked} onClick={() => void importShared(state.preview)}><Plus size={16}/> {t('Import to my library')}</button>
        <button className="button" disabled={locked} onClick={() => void downloadShared(state.preview)}><ArrowDownToLine size={15}/> {t('Download copy')}</button>
      </div>
    </div>}
    {state.kind === 'ready' && (explained.summary || explained.scanning || (marks && explained.check) || engine === 'none') && <section className="panel shared-about" aria-live="polite">
      <h2>{t('What is this?')}</h2>
      {explained.summary && <p>{explained.summary}</p>}
      {explained.scanning && <p className="local-ai-line"><LoaderCircle size={16} className="spin"/> {t('The local AI is reading this project…')}</p>}
      {explained.check && <ContentNote check={explained.check}/>}
      {engine === 'none' && <p className="muted-text">{t('With a local AI (Settings) LocalDeck also explains what a shared project is.')}</p>}
    </section>}
    {state.kind === 'problem' && <div className="shared-error" role="alert">
      <Info size={20}/>
      <h2>{t(state.problem.title)}</h2>
      <p>{t(state.problem.message)}</p>
      <div className="shared-error-actions">
        {state.problem.retry && <button className="button primary" onClick={() => setAttempt(count => count + 1)}><RefreshCw size={15}/> {t('Try again')}</button>}
        <button className="button" onClick={() => go('home')}>{t('Open my library')}</button>
      </div>
    </div>}
    {state.kind === 'problem' && state.needsApi && <form className="share-setup panel" onSubmit={connect}>
      <label className="form-field"><span>{t('Sharing service address')}</span><input type="url" value={apiDraft} onChange={event => setApiDraft(event.target.value)} placeholder="https://your-worker.workers.dev"/></label>
      <button className="button" type="submit">{t('Open the link')}</button>
    </form>}
  </>;
}
