/* Settings: the local AI that runs inside the browser and fills in the details of projects. */
import { useEffect, useState } from 'react';
import { Check, CircleOff, Cpu, Download, Gauge, LoaderCircle, ScanText, Trash2, X, Zap, type LucideIcon } from 'lucide-react';
import { t } from './i18n';
import { rovingKeys } from './a11y';
import { cancelWaiting, scanLibrary, setAutoScan, useAutoScan } from './autoScan';
import { cancelLoading, checkAgain, checkLocalAi, chooseEngine, isModel, loadLocalAi, modelOf, removeLocalAi, useLocalAi, type EngineId } from './localAi/engine';
import { MODEL, SMALL } from './localAi/model';
import { bytes, go } from './shared';

const errorText = (error: string, size: number) => error === 'network' ? t('The model could not be loaded. Check your internet connection and try again.')
  : error === 'memory' ? t('This device does not have enough memory for the model. Close other tabs and programs, then try again.')
    : error === 'old' ? t('This browser is too old for the model. Update it, then try again.')
    : error === 'missing' ? t('This browser has no WebGPU, which the model needs. A current version of Chrome, Edge or Safari has it.')
    : error === 'blocked' || error === 'webgpu' ? t('The browser cannot use your graphics chip at the moment. Turn on hardware acceleration in the browser settings, then restart the browser.')
    : error === 'software' ? t('This device draws without a graphics chip, so the model would be far too slow.')
    : error === 'crash' ? t('LocalDeck was closed while the model was starting. This device probably has too little memory for it.')
      : error === 'space' ? t('There is not enough free browser storage. The model needs about {0}.', bytes(size))
        : t('The model could not be started. Reload the page and try again.');

/** Status, progress and buttons. Also shown on the details page while the AI is not ready. */
export function LocalAiStatus({ compact = false }: { compact?: boolean }) {
  const state = useLocalAi();
  useEffect(() => { void checkLocalAi(); }, []);
  const model = modelOf(state.engine), chosen = isModel(state.engine);
  const part = Math.min(1, state.loaded / Math.max(1, state.total));
  const start = () => { void loadLocalAi().catch(() => undefined); };
  const busy = state.phase === 'loading' || state.phase === 'preparing';
  if (state.phase === 'checking') return <p className="local-ai-line" role="status"><LoaderCircle size={16} className="spin"/> {t('Checking what this device can do…')}</p>;
  const instead = <p className="local-ai-line good"><Check size={16}/> {t('Until then the quick scan does the work.')}</p>;
  if (chosen && state.phase === 'unsupported') return <div className="local-ai-status"><p className="local-ai-line warn" role="status"><X size={16}/> {errorText(state.engine === 'small' ? 'old' : state.gpu, model.bytes)}</p>{instead}{state.engine === 'qwen' && state.cpu && <button type="button" className="button primary" onClick={() => chooseEngine('small')}><Gauge size={15}/> {t('Use {0}, it needs no graphics chip', SMALL.name)}</button>}<button type="button" className="button" onClick={() => void checkAgain()}>{t('Check again')}</button></div>;
  return <div className="local-ai-status">
    {(state.engine === 'browser' || chosen) && state.phase === 'ready' && <p className="local-ai-line good" role="status"><Check size={16}/> {state.engine === 'browser' ? t('Ready. Your browser already contains an AI, so nothing is loaded.') : t('Ready. The model runs on this device.')}</p>}
    {chosen && state.phase === 'off' && (state.stored
      ? <p className="local-ai-line good"><Check size={16}/> {t('{0} is stored in this browser and works without internet. It starts when you scan a project.', model.name)}</p>
      : <><p className="local-ai-line">{state.share > 0 ? t('{0} % of the model is already loaded. It continues where it stopped.', Math.round(state.share * 100)) : t('Nothing is installed. The model ({0}) is loaded into this browser once and then works without internet.', bytes(model.bytes))}</p><button type="button" className="button primary" onClick={start}><Download size={15}/> {state.share > 0 ? t('Continue loading') : t('Set up the AI')}</button></>)}
    {busy && <>
      <p className="local-ai-line" role="status"><LoaderCircle size={16} className="spin"/> {state.phase === 'preparing' && state.engine === 'small' ? t('Starting the AI…') : state.phase === 'preparing' ? t('Preparing the AI on your graphics chip…') : state.stored ? t('Starting the AI…') : t('Loading the model: {0} of {1}', bytes(state.loaded), bytes(state.total))}</p>
      <div className={`progress-bar ${state.phase === 'loading' ? 'determinate' : 'indeterminate'}`} role="progressbar" aria-label={t('Loading the model')} aria-valuenow={state.phase === 'loading' ? Math.round(part * 100) : undefined}><i style={state.phase === 'loading' ? { width: `${Math.round(part * 100)}%` } : undefined}/></div>
      <button type="button" className="button" onClick={cancelLoading}><X size={15}/> {t('Cancel')}</button>
    </>}
    {chosen && state.phase === 'failed' && <><p className="local-ai-line warn" role="alert"><X size={16}/> {errorText(state.error, model.bytes)}</p>{instead}<button type="button" className="button" onClick={start}>{t('Try again')}</button></>}
    {!compact && (state.stored || state.share > 0) && !busy && <button type="button" className="button danger-button" onClick={() => { if (window.confirm(t('Delete the model from this browser? You can load it again at any time.'))) void removeLocalAi(); }}><Trash2 size={15}/> {t('Delete the model')}</button>}
  </div>;
}

export function LocalAiSettings() {
  const { browserAi, engine, phase } = useLocalAi();
  const queue = useAutoScan();
  const [answer, setAnswer] = useState('');
  const running = queue.active !== null || queue.waiting.length > 0;
  const scanAll = async () => { setAnswer(''); const found = await scanLibrary(); setAnswer(found ? '' : t('Every project is already checked.')); };
  const busy = phase === 'loading' || phase === 'preparing';
  const choices: Array<{ id: EngineId; name: string; detail: string; icon: LucideIcon }> = [
    { id: 'instant', name: t('Quick scan'), detail: t('Nothing to load, works on every device'), icon: Zap },
    ...(browserAi ? [{ id: 'browser' as const, name: t('AI of the browser'), detail: t('Nothing to load'), icon: Cpu }] : []),
    { id: 'small', name: SMALL.name, detail: t('For every device, takes longer, loaded once, {0}', bytes(SMALL.bytes)), icon: Gauge },
    { id: 'qwen', name: MODEL.name, detail: t('Best texts, needs a graphics chip, loaded once, {0}', bytes(MODEL.bytes)), icon: Cpu },
    { id: 'none', name: t('Off'), detail: t('Projects are not described'), icon: CircleOff },
  ];
  return <div className="local-ai">
    <p className="ai-intro">{t('LocalDeck reads every project you import and every shared link you open, on your device. It explains what it is and adds name, subject and hashtags. The quick scan needs no AI and no download. An AI writes better texts. Your projects never leave the device.')}</p>
    <div className="local-ai-choice" role="radiogroup" aria-label={t('Local AI')} onKeyDown={event => rovingKeys(event, '[role="radio"]', true)}>{choices.map(({ id, name, detail, icon: Icon }) => <button key={id} type="button" role="radio" aria-checked={engine === id} tabIndex={engine === id ? 0 : -1} disabled={busy} className="language-card" onClick={() => chooseEngine(id)}><span className="language-mark" aria-hidden="true"><Icon size={17}/></span><span className="language-name"><b>{name}</b><small>{detail}</small></span>{engine === id && <Check size={16} className="language-check"/>}</button>)}</div>
    <LocalAiStatus/>
    {engine === 'small' && <p className="local-ai-note">{t('It runs on the processor and needs no graphics chip. A project takes about a minute on a computer and a few minutes on a phone, so keep the page open. It reads the beginning and a part of the middle. It is a small model and makes mistakes, so check its suggestions. The model files come from Hugging Face, which sees your IP address while they load.')}</p>}
    {engine === 'qwen' && <p className="local-ai-note">{t('It is a small model and makes mistakes, so check its suggestions. Qwen needs a computer or phone with a fairly new graphics chip. The model files come from Hugging Face, which sees your IP address while they load.')}</p>}
    {engine !== 'none' && <label className="setting-row local-ai-auto"><span><b>{t('Scan every import automatically')}</b><small>{t('Fills in what is missing and adds hashtags. What you wrote stays.')}</small></span><input type="checkbox" checked={queue.auto} onChange={event => setAutoScan(event.target.checked)}/></label>}
    {engine !== 'none' && <div className="local-ai-status">
      {running ? <><p className="local-ai-line" role="status"><LoaderCircle size={16} className="spin"/> {queue.total > 1 ? t('Reading project {0} of {1}…', Math.min(queue.done + 1, queue.total), queue.total) : t('Reading the project…')}</p>{queue.waiting.length > 0 && <button type="button" className="button" onClick={cancelWaiting}><X size={15}/> {t('Cancel')}</button>}</>
        : <button type="button" className="button" onClick={() => void scanAll()}><ScanText size={15}/> {t('Check the whole library')}</button>}
      {answer && <p className="local-ai-line good" role="status"><Check size={16}/> {answer}</p>}
    </div>}
    {engine !== 'none' && <button type="button" className="text-button" onClick={() => go('library')}>{t('Go to the library')}</button>}
  </div>;
}
