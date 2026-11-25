import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { chooseLanguage, LANGUAGES, language, languageChoice, t, type LanguageChoice } from './i18n';
import { rovingKeys } from './a11y';

/** Language cards in Settings. */
export function LanguageSettings() {
  const choice = languageChoice();
  const [pending, setPending] = useState<LanguageChoice | null>(null);
  const select = (id: LanguageChoice) => { if (id === choice) return; setPending(id); chooseLanguage(id); };
  const options: Array<{ id: LanguageChoice; name: string; detail: string }> = [
    { id: 'system', name: t('Automatic'), detail: t('Follows your browser: {0}', LANGUAGES.find(entry => entry.id === language())!.name) },
    ...LANGUAGES.map(entry => ({ ...entry, detail: '' })),
  ];
  return <div className="language-grid" role="radiogroup" aria-label={t('Language')} onKeyDown={event => rovingKeys(event, '[role="radio"]')}>
    {options.map(option => <button key={option.id} type="button" role="radio" aria-checked={choice === option.id} tabIndex={choice === option.id ? 0 : -1}
      className={`language-card ${pending === option.id ? 'pending' : ''}`} lang={option.id === 'system' ? undefined : option.id} onClick={() => select(option.id)}>
      <span className="language-mark" aria-hidden="true">{option.id === 'system' ? <Languages size={17}/> : option.id.toUpperCase()}</span>
      <span className="language-name"><b>{option.name}</b>{option.id === 'system' && choice === 'system' && <small>{option.detail}</small>}</span>
      {choice === option.id && <Check size={16} className="language-check"/>}
    </button>)}
  </div>;
}

/** Small picker for the sign-in pages, which have no Settings. */
export function LanguagePicker() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const id = useId(), current = language();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  return <div ref={root} className="language-picker" onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}>
    <button ref={button} type="button" className="language-button" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <Languages size={16} aria-hidden="true"/><span className="visually-hidden">{t('Language')}: </span><span>{LANGUAGES.find(entry => entry.id === current)!.name}</span><ChevronDown size={15} aria-hidden="true" className="language-chevron"/>
    </button>
    {open && <div id={id} className="language-menu" role="menu" aria-label={t('Language')} onKeyDown={event => rovingKeys(event, '[role="menuitemradio"]')}>
      {LANGUAGES.map(entry => <button key={entry.id} type="button" role="menuitemradio" aria-checked={entry.id === current} tabIndex={entry.id === current ? 0 : -1} lang={entry.id} onClick={() => { close(); if (entry.id !== current) chooseLanguage(entry.id); }}>
        <span className="language-code" aria-hidden="true">{entry.id.toUpperCase()}</span><span>{entry.name}</span>{entry.id === current && <Check size={16} aria-hidden="true"/>}
      </button>)}
    </div>}
  </div>;
}
