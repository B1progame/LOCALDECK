import test from 'node:test';
import assert from 'node:assert/strict';
import { findSubject, keywords, pageLanguage, quickScan } from '../src/services/quickScan.ts';

const page = more => ({ title: '', language: '', description: '', headings: [], buttons: [], text: '', ...more });
const volcano = page({ title: 'Vulkane', language: 'de', headings: ['Vulkane', 'Schildvulkane', 'Schichtvulkane'], text: 'Vulkane entstehen dort, wo Magma aus dem Erdinneren aufsteigt. Schildvulkane haben flache Hänge. Schichtvulkane bestehen aus Asche und Lava. Der Vesuv zerstörte Pompeji. Das Magma ist heiß, und die Lava fließt. Magma und Lava sind nicht dasselbe.', kind: 'learning' });

test('a study sheet gets name, subject, description and hashtags', () => {
  const { suggestion, quick, found } = quickScan(volcano, { filename: 'index.html', fallback: 'de' });
  assert.deepEqual([suggestion.title, suggestion.subject, suggestion.type, quick, found], ['Vulkane', 'Erdkunde', 'learning', true, null]);
  assert.match(suggestion.description, /^Ein Lernzettel über .* und .*\.$/);
  for (const tag of ['Vulkane', 'Magma', 'Lava']) assert.ok(suggestion.tags.includes(tag), tag + ' in ' + suggestion.tags);
  for (const tag of suggestion.tags) assert.ok(!/^(dort|haben|nicht|bestehen|entstehen)$/i.test(tag), tag);
});

test('a quiz without a name is named after its words', () => {
  const quiz = page({ title: 'Document', language: 'de', kind: 'quiz', text: 'Weiter\nWas ist die Hauptstadt von Frankreich?\nParis\nMadrid\nWas ist die Hauptstadt von Spanien?\nMadrid\nRom\nWas ist die Hauptstadt von Italien?\nRom\nRichtig!\nFalsch!' });
  const { suggestion } = quickScan(quiz, { filename: 'main.html', fallback: 'de' });
  assert.match(suggestion.title, /^Quiz: Hauptstadt/);
  assert.equal(suggestion.subject, 'Erdkunde');
  assert.ok(!suggestion.tags.some(tag => /richtig|falsch|weiter|document/i.test(tag)), suggestion.tags.join());
});

test('the text of the page is preferred over a made-up sentence, games get no subject', () => {
  assert.equal(quickScan(page({ ...volcano, description: 'Alles über Vulkane.' }), { filename: 'a', fallback: 'de' }).suggestion.description, 'Alles über Vulkane.');
  assert.equal(quickScan(page({ ...volcano, intro: 'Vulkane sind Öffnungen in der Erdkruste.' }), { filename: 'a', fallback: 'de' }).suggestion.description, 'Vulkane sind Öffnungen in der Erdkruste.');
  const game = quickScan(page({ title: 'Neon Drift', language: 'en', kind: 'game', text: 'SCORE 0 BEST 0 Change lanes. Dodge the traffic on a neon highway. Force and energy.' }), { filename: 'a', fallback: 'de' }).suggestion;
  assert.deepEqual([game.title, game.type, game.subject, game.topic], ['Neon Drift', 'game', '', '']);
  assert.match(game.description, /^A game with/);
});

test('the language is recognized, also when the page says the wrong one', () => {
  assert.equal(pageLanguage(volcano, 'en'), 'de');
  const wrong = { language: 'en', text: 'Dies ist ein Text, der nicht in der Sprache ist, die oben steht, und das sieht man an den vielen kleinen Wörtern, die hier sind und immer wieder kommen, weil das so ist.' };
  assert.equal(pageLanguage(wrong, 'en'), 'de');
  assert.equal(pageLanguage({ language: '', text: 'Snake' }, 'fr'), 'fr');
  assert.equal(pageLanguage({ language: 'nl', text: 'Snake' }, 'nl'), 'en');
  for (const [lang, text] of [['fr', 'Voici une fiche sur les plantes : elles ont besoin de lumière et de eau pour vivre, et dans les feuilles se trouve la chlorophylle qui est très importante.'], ['es', 'Las plantas necesitan luz y agua para vivir, y en las hojas está la clorofila que es muy importante para ellas cuando hay sol.'], ['it', 'Le piante hanno bisogno di luce e di acqua per vivere, e nelle foglie si trova la clorofilla che è molto importante quando c’è il sole.']]) assert.equal(pageLanguage({ language: '', text }, 'en'), lang, lang);
});

test('subjects need more than one chance word', () => {
  assert.equal(findSubject(page({ title: 'Ableitungen verstehen', text: 'Funktion Steigung Tangente' }), 'de'), 'Mathematik');
  assert.equal(findSubject(page({ title: 'Photosynthèse', text: 'cellule plante chlorophylle' }), 'fr'), 'Biologie');
  assert.equal(findSubject(page({ title: 'Einkaufsliste', text: 'Brot Milch Käse' }), 'de'), '');
  assert.equal(findSubject(page({ title: 'Notes', text: 'The heart of the matter is simple.' }), 'en'), '');
});

test('an empty page invents nothing', () => {
  assert.deepEqual(quickScan(page({}), { filename: 'x', fallback: 'de' }).suggestion, { title: '', type: '', subject: '', topic: '', description: '', tags: [] });
  assert.deepEqual(keywords(page({ text: 'const x = document.getElementById("a"); function doThing() { return innerWidth / 2; }' }), 'en').filter(entry => /getElement|innerWidth|doThing/.test(entry)), []);
});

test('a large page takes no noticeable time', () => {
  const start = performance.now();
  quickScan(page({ title: 'Groß', language: 'de', text: 'Vulkane und Magma in der Erdkruste. '.repeat(12_000) }), { filename: 'x', fallback: 'de' });
  assert.ok(performance.now() - start < 1500, String(performance.now() - start));
});
