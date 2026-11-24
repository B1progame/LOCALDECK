import { useState } from 'react';
import { Check, Languages } from 'lucide-react';
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
  return <label className="language-picker">
    <Languages size={15} aria-hidden="true"/><span className="visually-hidden">{t('Language')}</span>
    <select value={language()} onChange={event => chooseLanguage(event.target.value as LanguageChoice)}>{LANGUAGES.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
  </label>;
}
