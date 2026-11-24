/* Settings: the local AI that runs inside the browser and fills in the details of projects. */
import { useEffect } from 'react';
import { Check, CircleOff, Cpu, Download, LoaderCircle, Trash2, X, type LucideIcon } from 'lucide-react';
import { t } from './i18n';
import { rovingKeys } from './a11y';
import { cancelLoading, checkLocalAi, chooseEngine, loadLocalAi, removeLocalAi, useLocalAi, type EngineId } from './localAi/engine';
import { MODEL } from './localAi/model';
import { bytes, go } from './shared';

const errorText = (error: string) => error === 'network' ? t('The model could not be loaded. Check your internet connection and try again.')
  : error === 'memory' ? t('This device does not have enough memory for the model. Close other tabs and programs, then try again.')
    : error === 'webgpu' ? t('This browser has no WebGPU, which the model needs. A current version of Chrome, Edge or Safari has it.')
      : error === 'space' ? t('There is not enough free browser storage. The model needs about {0}.', bytes(MODEL.bytes))
        : t('The model could not be started. Reload the page and try again.');

/** Status, progress and buttons. Also shown on the details page while the AI is not ready. */
export function LocalAiStatus({ compact = false }: { compact?: boolean }) {
  const state = useLocalAi();
  useEffect(() => { void checkLocalAi(); }, []);
  const part = Math.min(1, state.loaded / Math.max(1, state.total));
  const start = () => { void loadLocalAi().catch(() => undefined); };
  const busy = state.phase === 'loading' || state.phase === 'preparing';
  if (state.phase === 'checking') return <p className="local-ai-line" role="status"><LoaderCircle size={16} className="spin"/> {t('Checking what this device can do…')}</p>;
  if (state.engine === 'qwen' && state.phase === 'unsupported') return <p className="local-ai-line warn" role="status"><X size={16}/> {errorText('webgpu')}</p>;
  return <div className="local-ai-status">
    {state.engine !== 'none' && state.phase === 'ready' && <p className="local-ai-line good" role="status"><Check size={16}/> {state.engine === 'browser' ? t('Ready. Your browser already contains an AI, so nothing is loaded.') : t('Ready. The model runs on this device.')}</p>}
    {state.engine === 'qwen' && state.phase === 'off' && (state.stored
      ? <p className="local-ai-line good"><Check size={16}/> {t('{0} is stored in this browser and works without internet. It starts when you scan a project.', MODEL.name)}</p>
      : <><p className="local-ai-line">{t('Nothing is installed. The model ({0}) is loaded into this browser once and then works without internet.', bytes(MODEL.bytes))}</p><button type="button" className="button primary" onClick={start}><Download size={15}/> {t('Set up the AI')}</button></>)}
    {busy && <>
      <p className="local-ai-line" role="status"><LoaderCircle size={16} className="spin"/> {state.phase === 'preparing' ? t('Preparing the AI on your graphics chip…') : state.stored ? t('Starting the AI…') : t('Loading the model: {0} of {1}', bytes(state.loaded), bytes(state.total))}</p>
      <div className={`progress-bar ${state.phase === 'loading' ? 'determinate' : 'indeterminate'}`} role="progressbar" aria-label={t('Loading the model')} aria-valuenow={state.phase === 'loading' ? Math.round(part * 100) : undefined}><i style={state.phase === 'loading' ? { width: `${Math.round(part * 100)}%` } : undefined}/></div>
      <button type="button" className="button" onClick={cancelLoading}><X size={15}/> {t('Cancel')}</button>
    </>}
    {state.engine === 'qwen' && state.phase === 'failed' && <><p className="local-ai-line warn" role="alert"><X size={16}/> {errorText(state.error)}</p><button type="button" className="button" onClick={start}>{t('Try again')}</button></>}
    {!compact && state.stored && !busy && <button type="button" className="button danger-button" onClick={() => { if (window.confirm(t('Delete the model from this browser? You can load it again at any time.'))) void removeLocalAi(); }}><Trash2 size={15}/> {t('Delete the model')}</button>}
  </div>;
}

export function LocalAiSettings() {
  const { browserAi, engine, phase } = useLocalAi();
  const busy = phase === 'loading' || phase === 'preparing';
  const choices: Array<{ id: EngineId; name: string; detail: string; icon: LucideIcon }> = [
    { id: 'none', name: t('Off'), detail: t('No AI'), icon: CircleOff },
    ...(browserAi ? [{ id: 'browser' as const, name: t('AI of the browser'), detail: t('Nothing to load'), icon: Cpu }] : []),
    { id: 'qwen', name: MODEL.name, detail: t('Loaded once, {0}', bytes(MODEL.bytes)), icon: Cpu },
  ];
  return <div className="local-ai">
    <p className="ai-intro">{t('Choose an AI that runs inside this website on your device. Then open the details of a project and press “Scan this project”. The AI reads the whole HTML and suggests name, hashtags, description and the rest. Your projects never leave the device.')}</p>
    <div className="local-ai-choice" role="radiogroup" aria-label={t('Local AI')} onKeyDown={event => rovingKeys(event, '[role="radio"]', true)}>{choices.map(({ id, name, detail, icon: Icon }) => <button key={id} type="button" role="radio" aria-checked={engine === id} tabIndex={engine === id ? 0 : -1} disabled={busy} className="language-card" onClick={() => chooseEngine(id)}><span className="language-mark" aria-hidden="true"><Icon size={17}/></span><span className="language-name"><b>{name}</b><small>{detail}</small></span>{engine === id && <Check size={16} className="language-check"/>}</button>)}</div>
    <LocalAiStatus/>
    {engine === 'qwen' && <p className="local-ai-note">{t('It is a small model and makes mistakes, so check its suggestions. Qwen needs a computer or phone with a fairly new graphics chip. The model files come from Hugging Face, which sees your IP address while they load.')}</p>}
    {engine !== 'none' && <button type="button" className="text-button" onClick={() => go('library')}>{t('Go to the library')}</button>}
  </div>;
}
