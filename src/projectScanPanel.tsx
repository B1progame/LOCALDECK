/* Project details: the local AI reads the whole HTML project and suggests name, hashtags and the rest. */
import React, { useEffect, useRef, useState } from 'react';
import { Check, CircleStop, LoaderCircle, ScanText, X } from 'lucide-react';
import { language, t } from './i18n';
import { cancelLoading, generateText, loadLocalAi, stopGenerating, useLocalAi } from './localAi/engine';
import { LocalAiStatus } from './localAiSettings';
import { getAssets } from './services/library';
import { htmlText, parseTags, scriptTexts, suggestDetails, type ProjectText, type Suggestion } from './services/projectScan';
import { TYPE_LABEL, useItemActions } from './shared';
import type { ContentType, LibraryItem } from './types';

const MAX_FILE = 8 * 1024 * 1024;

/** The entry page first, then the other pages, then the texts of scripts and data files. */
async function readProject(item: LibraryItem): Promise<ProjectText> {
  const assets = (await getAssets(item.id)).filter(asset => asset.fileSize <= MAX_FILE);
  const entry = assets.find(asset => asset.normalizedPath === item.entryFile);
  if (!entry) throw new Error('no-entry');
  const project = htmlText(await entry.blob.text());
  const more: string[] = [];
  for (const asset of assets) {
    if (asset === entry || asset.normalizedPath === 'localdeck.json') continue;
    if (/\.html?$/i.test(asset.normalizedPath)) more.push(htmlText(await asset.blob.text()).text);
    else if (/\.(m?js|json)$/i.test(asset.normalizedPath)) more.push([...new Set(scriptTexts(await asset.blob.text()))].join('\n'));
    else if (/\.(txt|md|csv)$/i.test(asset.normalizedPath)) more.push(await asset.blob.text());
  }
  return { ...project, text: [project.text, ...more].filter(Boolean).join('\n') };
}

function languageName(code: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code || language()) ?? 'English'; } catch { return 'English'; }
}

type Draft = { title: string; type: ContentType; subject: string; topic: string; description: string; tags: string };
type Found = { suggestion: Suggestion; read: number; total: number };

export function ProjectScanPanel({ item }: { item: LibraryItem }) {
  const { engine, phase, stored } = useLocalAi();
  const a = useItemActions();
  const [step, setStep] = useState<{ step: number; steps: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const run = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { run.current = -1; stopGenerating(); }, []);
  if (engine === 'none') return null;
  const working = step !== null;
  const ready = engine === 'browser' || stored || phase === 'ready';

  const scan = async () => {
    const id = ++run.current;
    const cancelled = () => run.current !== id;
    setProblem(''); setDraft(null); setFound(null); setStep({ step: 0, steps: 0 });
    try {
      const project = await readProject(item);
      if (!project.text && !project.title) { setProblem(t('There is no text in this project that the AI could read.')); return; }
      await loadLocalAi();
      const result = await suggestDetails(project, {
        filename: item.originalFilename, language: languageName(project.language), cancelled,
        onStep: (at, steps) => { if (!cancelled()) setStep({ step: at, steps }); },
        ask: (messages, maxTokens) => cancelled() ? Promise.reject(new Error('cancelled')) : generateText(messages, () => undefined, { maxTokens, temperature: 0 }),
      });
      if (cancelled()) return;
      const { suggestion } = result;
      if (!suggestion.title && !suggestion.description && !suggestion.tags.length) { setProblem(t('The AI gave no usable answer. Try again.')); return; }
      const tags = parseTags([...item.tags, ...suggestion.tags].join(','));
      setFound(result);
      setDraft({ title: suggestion.title || item.title, type: suggestion.type || item.type, subject: suggestion.subject || item.subject, topic: suggestion.topic || item.topic, description: suggestion.description || item.description, tags: tags.join(', ') });
      window.setTimeout(() => heading.current?.focus(), 0);
    } catch (error) {
      if (cancelled()) return;
      const reason = error instanceof Error ? error.message : '';
      if (!['cancelled', 'removed'].includes(reason)) setProblem(reason === 'no-entry' ? t('The entry page of this project could not be read.') : t('The AI stopped before it was finished. Try again.'));
    } finally { if (!cancelled()) setStep(null); }
  };
  const stop = () => { run.current++; cancelLoading(); stopGenerating(); setStep(null); };
  const close = () => { setDraft(null); setFound(null); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft?.title.trim()) return;
    setSaving(true);
    try { await a.describe(item, { title: draft.title.trim(), type: draft.type, subject: draft.subject.trim(), topic: draft.topic.trim(), description: draft.description.trim(), tags: draft.tags.split(',').map(tag => tag.replace(/#/g, '').trim()).filter(Boolean) }); close(); }
    catch { /* the page shows the reason */ }
    finally { setSaving(false); }
  };
  const field = (key: 'title' | 'subject' | 'topic' | 'tags', label: string, max: number, before: string) => <label className="form-field"><span>{label}</span><input value={draft![key]} maxLength={max} required={key === 'title'} onChange={event => setDraft({ ...draft!, [key]: event.target.value })}/>{before && before !== draft![key] && <small className="scan-before">{t('Before: {0}', before)}</small>}</label>;

  return <section className="panel scan-panel" aria-busy={working}>
    <div className="panel-title-row"><h2 ref={heading} tabIndex={-1}>{draft ? t('Suggestion of the local AI') : t('Local AI')}</h2>{found && draft && <span className="muted-text">{found.read < found.total ? t('{0} of {1} parts read', found.read, found.total) : t('Whole project read')}</span>}</div>
    {!draft && <>
      <p className="muted-text">{t('Reads the whole HTML of this project on your device and suggests name, type, subject, topic, description and hashtags. Nothing changes before you save.')}</p>
      {!ready || phase === 'failed' || phase === 'unsupported' ? <LocalAiStatus compact/> : working
        ? <div className="scan-run"><p role="status"><LoaderCircle size={16} className="spin"/> {!step.steps ? (phase === 'ready' ? t('Reading the project…') : t('Starting the AI…')) : step.step < step.steps ? t('Reading part {0} of {1}…', step.step, step.steps - 1) : t('Writing name and hashtags…')}</p><div className={`progress-bar ${step.steps > 1 ? 'determinate' : 'indeterminate'}`} aria-hidden="true"><i style={step.steps > 1 ? { width: `${Math.round(step.step / (step.steps + 1) * 100)}%` } : undefined}/></div><button type="button" className="button" onClick={stop}><CircleStop size={15}/> {t('Stop')}</button></div>
        : <button type="button" className="button primary" onClick={() => void scan()}><ScanText size={16}/> {t('Scan this project')}</button>}
      {problem && phase !== 'failed' && <p className="dialog-error" role="alert">{problem}</p>}
    </>}
    {draft && <form onSubmit={event => void save(event)}>
      <div className="scan-fields">
        {field('title', t('Name'), 120, item.title)}
        <label className="form-field"><span>{t('Type')}</span><select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as ContentType })}>{Object.entries(TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{draft.type !== item.type && <small className="scan-before">{t('Before: {0}', TYPE_LABEL[item.type])}</small>}</label>
        {field('subject', t('Subject or category'), 60, item.subject)}
        {field('topic', t('Topic'), 80, item.topic)}
      </div>
      <label className="form-field"><span>{t('Description')}</span><textarea rows={3} maxLength={600} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/>{item.description && item.description !== draft.description && <small className="scan-before">{t('Before: {0}', item.description)}</small>}</label>
      {field('tags', t('Hashtags, separated by commas'), 300, item.tags.join(', '))}
      <p className="scan-hint">{t('A small AI makes mistakes. Check the fields, change what is wrong, then save.')}</p>
      <div className="scan-actions"><button className="button primary" disabled={saving || !draft.title.trim()}>{saving ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>} {t('Save')}</button><button type="button" className="button" disabled={saving} onClick={close}><X size={15}/> {t('Discard')}</button><button type="button" className="text-button" disabled={saving} onClick={() => void scan()}>{t('Scan again')}</button></div>
    </form>}
  </section>;
}
