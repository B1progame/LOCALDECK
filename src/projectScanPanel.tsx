/* Project details: the local AI reads the whole HTML project and suggests name, hashtags and the rest. */
import React, { useEffect, useRef, useState } from 'react';
import { Check, CircleStop, LoaderCircle, ScanText, X } from 'lucide-react';
import { t } from './i18n';
import { askAbout, kindTag, readItem, ruleCheck, useAutoScan, withAi } from './autoScan';
import { cancelLoading, stopGenerating, useLocalAi } from './localAi/engine';
import { ContentNote } from './contentNote';
import { LocalAiStatus } from './localAiSettings';
import { withOpinion, type ContentCheck } from './services/contentCheck';
import { importantTags, MAX_TAGS, type ScanResult } from './services/projectScan';
import { TYPE_LABEL, useItemActions } from './shared';
import type { ContentType, LibraryItem } from './types';

type Draft = { title: string; type: ContentType; subject: string; topic: string; description: string; tags: string };

export function ProjectScanPanel({ item }: { item: LibraryItem }) {
  const { engine, phase } = useLocalAi();
  const { active, waiting } = useAutoScan();
  const key = `panel:${item.id}`, owns = useRef(false);
  const inBackground = active === item.id || waiting.includes(item.id);
  const a = useItemActions();
  const [step, setStep] = useState<{ step: number; steps: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [found, setFound] = useState<(ScanResult & { check: ContentCheck }) | null>(null);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const run = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { run.current = -1; if (owns.current) { cancelLoading(); stopGenerating(); } }, []);
  if (engine === 'none') return null;
  const working = step !== null;
  const model = engine === 'browser' || engine === 'qwen';

  const scan = async () => {
    const id = ++run.current;
    const cancelled = () => run.current !== id;
    setProblem(''); setDraft(null); setFound(null); setStep({ step: 0, steps: 0 });
    try {
      const project = await readItem(item);
      if (!project.text && !project.title) { setProblem(t('There is no text in this project that the AI could read.')); return; }
      const result = await withAi(key, async () => {
        owns.current = true;
        try { return await askAbout(project, item.originalFilename, { cancelled, onStep: (at, steps) => { if (!cancelled()) setStep({ step: at, steps }); } }); }
        finally { owns.current = false; }
      });
      if (cancelled()) return;
      const { suggestion } = result;
      if (!suggestion.title && !suggestion.description && !suggestion.tags.length) { setProblem(t('The AI gave no usable answer. Try again.')); return; }
      const tags = importantTags(item.tags, suggestion, kindTag(suggestion.type || item.type));
      setFound({ ...result, check: result.quick ? { ...ruleCheck(project, { ...item, tags }), scanned: 'quick' } : withOpinion(ruleCheck(project, { ...item, tags }), result.found, suggestion.description) });
      setDraft({ title: suggestion.title || item.title, type: suggestion.type || item.type, subject: suggestion.subject || item.subject, topic: suggestion.topic || item.topic, description: suggestion.description || item.description, tags: tags.join(', ') });
      window.setTimeout(() => heading.current?.focus(), 0);
    } catch (error) {
      if (cancelled()) return;
      const reason = error instanceof Error ? error.message : '';
      if (!['cancelled', 'removed'].includes(reason)) setProblem(reason === 'no-entry' ? t('The entry page of this project could not be read.') : t('The AI stopped before it was finished. Try again.'));
    } finally { if (!cancelled()) setStep(null); }
  };
  const stop = () => { run.current++; if (owns.current) { cancelLoading(); stopGenerating(); } setStep(null); };
  const close = () => { setDraft(null); setFound(null); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft?.title.trim() || !found) return;
    setSaving(true);
    try { await a.describe(item, { title: draft.title.trim(), type: draft.type, subject: draft.subject.trim(), topic: draft.topic.trim(), description: draft.description.trim(), tags: draft.tags.split(',').map(tag => tag.replace(/#/g, '').trim()).filter(Boolean).slice(0, Math.max(MAX_TAGS, item.tags.length)), contentCheck: { ...found.check, ...(item.contentCheck?.confirmed ? { confirmed: true } : {}) } }); close(); }
    catch { /* the page shows the reason */ }
    finally { setSaving(false); }
  };
  const field = (key: 'title' | 'subject' | 'topic' | 'tags', label: string, max: number, before: string) => <label className="form-field"><span>{label}</span><input value={draft![key]} maxLength={max} required={key === 'title'} onChange={event => setDraft({ ...draft!, [key]: event.target.value })}/>{before && before !== draft![key] && <small className="scan-before">{t('Before: {0}', before)}</small>}</label>;

  return <section className="panel scan-panel" aria-busy={working}>
    <div className="panel-title-row"><h2 ref={heading} tabIndex={-1}>{draft ? found?.quick ? t('Suggestion of the quick scan') : t('Suggestion of the local AI') : model ? t('Local AI') : t('Quick scan')}</h2>{found && draft && <span className="muted-text">{found.read < found.total ? t('{0} of {1} parts read', found.read, found.total) : t('Whole project read')}</span>}</div>
    {!draft && <>
      <p className="muted-text">{t('Reads the whole HTML of this project on your device and suggests name, type, subject, topic, description and hashtags. Nothing changes before you save.')}</p>
      {engine === 'qwen' && phase !== 'ready' && !working && <div className="scan-model"><LocalAiStatus compact/></div>}
      {working
        ? <div className="scan-run"><p role="status"><LoaderCircle size={16} className="spin"/> {!step.steps ? (active && active !== key ? t('Waiting for another project…') : phase === 'ready' ? t('Reading the project…') : t('Starting the AI…')) : step.step < step.steps ? t('Reading part {0} of {1}…', step.step, step.steps - 1) : t('Writing name and hashtags…')}</p><div className={`progress-bar ${step.steps > 1 ? 'determinate' : 'indeterminate'}`} aria-hidden="true"><i style={step.steps > 1 ? { width: `${Math.round(step.step / (step.steps + 1) * 100)}%` } : undefined}/></div><button type="button" className="button" onClick={stop}><CircleStop size={15}/> {t('Stop')}</button></div>
        : inBackground ? <p className="local-ai-line" role="status"><LoaderCircle size={16} className="spin"/> {active === item.id ? t('The local AI is reading this project…') : t('This project is waiting for the local AI…')}</p>
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
      {found && found.check.rating !== 'ok' && <ContentNote check={found.check}/>}
      <p className="scan-hint">{found?.quick ? t('Taken from the words on the page. Check the fields, change what is wrong, then save.') : t('A small AI makes mistakes. Check the fields, change what is wrong, then save.')}</p>
      <div className="scan-actions"><button className="button primary" disabled={saving || !draft.title.trim()}>{saving ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>} {t('Save')}</button><button type="button" className="button" disabled={saving} onClick={close}><X size={15}/> {t('Discard')}</button><button type="button" className="text-button" disabled={saving} onClick={() => void scan()}>{t('Scan again')}</button></div>
    </form>}
  </section>;
}
