import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { LANGUAGES, matchLanguage, plural, t, tm, useDictionary } from '../src/i18n.ts';

const locales = {};
for (const { id } of LANGUAGES) if (id !== 'en') locales[id] = (await import(`../src/locales/${id}.ts`)).default;

const literal = String.raw`'((?:[^'\\]|\\.)*)'`;
const unescape = text => text.replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
const used = new Set();
for (const file of readdirSync('src').filter(name => /\.tsx?$/.test(name))) {
  const source = readFileSync(`src/${file}`, 'utf8');
  for (const match of source.matchAll(new RegExp(`(?<![\\w.])t\\(${literal}`, 'g'))) used.add(unescape(match[1]));
  for (const match of source.matchAll(new RegExp(`(?<![\\w.])plural\\([^']*?${literal}, ${literal}`, 'g'))) { used.add(unescape(match[1])); used.add(unescape(match[2])); }
}

test('every text of the app is translated into every language', () => {
  assert.ok(used.size > 700);
  for (const [id, messages] of Object.entries(locales)) assert.deepEqual([...used].filter(key => !messages[key]), [], `missing in ${id}`);
});

test('translations keep their placeholders and use no em dashes', () => {
  const holes = text => [...new Set(text.match(/\{\d\}/g) ?? [])].sort().join();
  for (const [id, messages] of Object.entries(locales)) for (const [key, value] of Object.entries(messages)) {
    if (!/reference\{1\}/.test(key)) assert.equal(holes(value), holes(key), `${id}: ${key}`);
    assert.doesNotMatch(value, /—/, `${id}: ${key}`);
    assert.ok(value.trim(), `${id}: ${key}`);
  }
});

test('the browser language is matched, and English is the fallback', () => {
  assert.equal(matchLanguage(['de-AT', 'en']), 'de');
  assert.equal(matchLanguage(['pl', 'it-IT']), 'it');
  assert.equal(matchLanguage(['ja']), 'en');
});

test('values, plurals and finished error messages are translated', () => {
  useDictionary('de', locales.de);
  assert.equal(t('Added “{0}” to favorites.', 'Mathe'), '„Mathe“ ist jetzt ein Favorit.');
  assert.equal(plural(1, '{0} project', '{0} projects', 1), '1 Projekt');
  assert.equal(plural(3, '{0} project', '{0} projects', 3), '3 Projekte');
  assert.equal(t('Not a known text'), 'Not a known text');
  assert.equal(tm('This package is empty.'), 'Dieses Paket ist leer.');
  assert.equal(tm('game.zip exceeds the 50 MB per-file import limit.'), 'game.zip ist größer als 50 MB.');
  assert.equal(tm('Backup file “a.png” is missing for project “Quiz”.'), 'Im Backup fehlt die Datei „a.png“ von „Quiz“.');
  assert.equal(tm('3 remote file references detected. The isolated player blocks remote scripts, images, fonts, and styles; they may also be unavailable offline.').slice(0, 10), '3 Verweise');
  assert.equal(tm('Something nobody translated'), 'Something nobody translated');
  useDictionary('en', {});
  assert.equal(tm('This package is empty.'), 'This package is empty.');
});
