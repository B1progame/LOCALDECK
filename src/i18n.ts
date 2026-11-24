/* Translations. The English text in the source is the key, so a missing translation falls back to English.
   The language is loaded before the app starts (src/boot.ts) and changing it reloads the page. */

export type Language = 'en' | 'de' | 'fr' | 'es' | 'it';
export type LanguageChoice = Language | 'system';
type Dictionary = Record<string, string>;

/** Names are written in their own language, so people find theirs without reading another one. */
export const LANGUAGES: Array<{ id: Language; name: string }> = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'fr', name: 'Français' },
  { id: 'es', name: 'Español' },
  { id: 'it', name: 'Italiano' },
];

const KEY = 'localdeck-language';
const isLanguage = (value: unknown): value is Language => LANGUAGES.some(language => language.id === value);

let current: Language = 'en';
let dictionary: Dictionary = {};
let rules = new Intl.PluralRules('en');
let patterns: Array<{ match: RegExp; key: string }> | null = null;

export const language = (): Language => current;

/** The first language of the browser that LocalDeck speaks. */
export function matchLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) { const id = tag.toLowerCase().split('-')[0]; if (isLanguage(id)) return id; }
  return 'en';
}

export function languageChoice(): LanguageChoice {
  try { const saved = localStorage.getItem(KEY); return isLanguage(saved) ? saved : 'system'; }
  catch { return 'system'; }
}

export function chooseLanguage(choice: LanguageChoice): void {
  if (choice === languageChoice()) return;
  try { if (choice === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch { return; }
  location.reload();
}

/** Also used by the tests. */
export function useDictionary(id: Language, next: Dictionary): void {
  current = id; dictionary = next; patterns = null; rules = new Intl.PluralRules(id);
}

export async function loadLanguage(): Promise<void> {
  const choice = languageChoice();
  const id = choice === 'system' ? matchLanguage(navigator.languages ?? [navigator.language]) : choice;
  try {
    if (id !== 'en') useDictionary(id, (await import(`./locales/${id}.ts`) as { default: Dictionary }).default);
  } catch { /* offline before this language was cached: English still works */ }
  document.documentElement.lang = current;
}

const fill = (text: string, args: unknown[]) => args.length ? text.replace(/\{(\d)\}/g, (_, index) => String(args[Number(index)] ?? '')) : text;

/** Translates a text. {0}, {1} … are replaced by the arguments. */
export function t(text: string, ...args: unknown[]): string {
  return fill(dictionary[text] ?? text, args);
}

/** Like t(), with a separate text for one and for many. */
export function plural(count: number, one: string, other: string, ...args: unknown[]): string {
  return t(rules.select(count) === 'one' ? one : other, ...args);
}

/** Translates a finished message, such as an error from src/services, where the values are already filled in. */
export function tm(message: string): string {
  if (current === 'en' || dictionary[message]) return dictionary[message] ?? message;
  patterns ??= Object.keys(dictionary).filter(key => /\{0\}/.test(key) && key.replace(/\{\d\}/g, '').trim().length > 8)
    .sort((a, b) => b.length - a.length)
    .map(key => ({ key, match: new RegExp(`^${key.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\d\}/g, '(.*?)')}$`, 's') }));
  for (const { key, match } of patterns) {
    const found = message.match(match);
    if (!found) continue;
    const order = [...key.matchAll(/\{(\d)\}/g)].map(part => Number(part[1]));
    const values: string[] = [];
    order.forEach((index, position) => { values[index] = found[position + 1]!; });
    return fill(dictionary[key]!, values);
  }
  return message;
}
