import test from 'node:test';
import assert from 'node:assert/strict';
import { grounded, guessType, MAX_PARTS, parseSuggestion, parseTags, scriptTexts, suggestDetails, textParts } from '../src/services/projectScan.ts';

test('texts inside scripts are found, code is not', () => {
  const texts = scriptTexts(`const q = [{ q: 'Was ist die Hauptstadt von Frankreich?', a: "Paris" }]; el.style.color = 'rgb(1,2,3)'; document.querySelector('.card'); import('./x.js'); const k = 'keydown'; const h = \`<b>Richtig, \${name}!</b>\`; fetch('https://example.com/a b');`);
  assert.ok(texts.includes('Was ist die Hauptstadt von Frankreich?'));
  assert.ok(texts.includes('Paris'));
  assert.ok(texts.some(text => text.startsWith('Richtig')));
  for (const bad of ['rgb(1,2,3)', '.card', 'keydown', './x.js', 'https://example.com/a b']) assert.ok(!texts.includes(bad), bad);
});

test('long texts are cut into parts without losing anything', () => {
  const text = Array.from({ length: 900 }, (_, index) => `Satz Nummer ${index}.`).join(' ');
  const { parts, total } = textParts(text);
  assert.equal(parts.length, total);
  assert.equal(parts.join(' '), text);
  assert.deepEqual(textParts(''), { parts: [], total: 0 });
  const huge = textParts('x'.repeat(4500 * 40));
  assert.equal(huge.parts.length, MAX_PARTS);
  assert.equal(huge.total, 40);
});

test('the answer is read, also with other labels and decoration', () => {
  assert.deepEqual(parseSuggestion('Name: "Fotosynthese-Quiz"\nType: Quiz\nSubject: Biologie\nTopic: Fotosynthese\nDescription: Ein Quiz über Pflanzen.\nTags: #Biologie, Pflanzen, HTML, Chlorophyll, biologie'), { title: 'Fotosynthese-Quiz', type: 'quiz', subject: 'Biologie', topic: 'Fotosynthese', description: 'Ein Quiz über Pflanzen.', tags: ['Biologie', 'Pflanzen', 'Chlorophyll'] });
  const german = parseSuggestion('Hier sind die Details:\n**Titel:** Vektoren\n- **Typ:** Lernzettel\n**Fach:** -\n**Thema:** keine\n**Beschreibung:**\nErklärt Vektoren: Länge und Winkel.\n**Schlagwörter:**\n- Vektor\n- Länge');
  assert.deepEqual(german, { title: 'Vektoren', type: 'learning', subject: '', topic: '', description: 'Erklärt Vektoren: Länge und Winkel.', tags: ['Vektor', 'Länge'] });
  assert.deepEqual(parseSuggestion('I cannot help'), { title: '', type: '', subject: '', topic: '', description: '', tags: [] });
});

test('hashtags without commas are split, long ones are dropped', () => {
  assert.deepEqual(parseTags('#snake #arcade #retro'), ['snake', 'arcade', 'retro']);
  assert.deepEqual(parseTags('a, das ist ein viel zu langer Satz, Spiel.'), ['Spiel']);
});

const page = more => ({ title: '', headings: [], text: '', canvas: false, ranges: 0, keys: false, ...more });
test('clear signs in the page decide the type', () => {
  assert.equal(guessType(page({ title: 'Photosynthese Quiz' })), 'quiz');
  assert.equal(guessType(page({ text: 'Wo?\nWas?\nWie?\nRichtig!' })), 'quiz');
  assert.equal(guessType(page({ text: 'Nächste Folie' })), 'presentation');
  assert.equal(guessType(page({ text: 'SCORE 0', keys: true })), 'game');
  assert.equal(guessType(page({ text: 'Length Gravity', canvas: true, ranges: 3 })), 'simulation');
  assert.equal(guessType(page({ title: 'Pomodoro' })), 'tool');
  assert.equal(guessType(page({ text: 'Hallo' })), '');
});

test('typical mistakes of the small model are corrected', async () => {
  const run = (answer, kind, language) => suggestDetails({ ...project('x'), kind }, { filename: 'a.html', language, ask: async () => answer }).then(result => result.suggestion);
  const quiz = await run('Name: Quiz\nType: app\nSubject: science\nTopic: Photosynthese\nDescription: D\nTags: a1, a1', 'quiz', 'German');
  assert.deepEqual([quiz.title, quiz.type, quiz.subject], ['Photosynthese Quiz', 'quiz', '']);
  const game = await run('Name: NEON DRIFT\nType: app\nSubject: science\nTopic: driving', 'game', 'English');
  assert.deepEqual([game.title, game.type, game.subject], ['NEON DRIFT', 'game', '']);
});

test('the name on the page wins, a meaningless one does not', async () => {
  const run = title => suggestDetails({ ...project('x'), title }, { filename: 'a.html', language: 'German', ask: async () => 'Name: Erfunden\nTopic: T\nTags: a1, b1, c1, d1, e1, f1, g1, h1, i1, j1, k1' }).then(result => result.suggestion);
  assert.equal((await run('Pixel Palette')).title, 'Pixel Palette');
  for (const title of ['Document', 'Vite + React App', '']) assert.equal((await run(title)).title, 'Erfunden', title);
  assert.equal((await run('')).tags.length, 10);
});

const project = text => ({ title: '', language: 'de', description: '', headings: ['H'], buttons: [], text });
const final = 'Name: Nokia\nType: game\nSubject: -\nTopic: Snake\nDescription: Ein Spiel.\nTags: Snake';

test('a short project needs one request, a long one reads every part first', async () => {
  const asked = [];
  const ask = async messages => { asked.push(messages.at(-1).content); return asked.at(-1).startsWith('Part ') ? 'Es geht um Schlangen.' : final; };
  const short = await suggestDetails(project('Snake spielen'), { filename: 'a.html', language: 'German', ask });
  assert.equal(asked.length, 1);
  assert.equal(short.suggestion.title, 'Nokia');
  asked.length = 0;
  const steps = [];
  const long = await suggestDetails(project('Snake '.repeat(2500)), { filename: 'a.html', language: 'German', ask, onStep: (step, all) => steps.push([step, all]) });
  assert.equal(long.read, long.total);
  assert.equal(asked.length, long.total + 1);
  assert.deepEqual(steps.at(-1), [long.total + 1, long.total + 1]);
  assert.match(asked.at(-1), /Part 1: Es geht um Schlangen/);
});

test('a stopped scan asks nothing more', async () => {
  let count = 0;
  await assert.rejects(suggestDetails(project('Wort '.repeat(2500)), { filename: 'a.html', language: 'German', ask: async () => { count++; return 'x'; }, cancelled: () => count >= 1 }), /cancelled/);
  assert.equal(count, 1);
});

test('an invented answer is replaced by one that fits the page', async () => {
  const text = 'Was ist die Hauptstadt von Frankreich?\nWas ist die Hauptstadt von Spanien?\nParis\nMadrid';
  assert.equal(grounded('mathematik Quiz', text), 0);
  assert.ok(grounded('Frankreich, Spanien', text) === 1);
  const ask = async messages => { const question = messages.at(-1).content; return question.includes('Only the keywords') ? 'Frankreich, Spanien, Paris, Algebra' : question.includes('In one sentence') ? 'Ein Quiz über die Hauptstadt von Frankreich und Spanien.' : 'Name: Quiz\nSubject: mathematik\nTopic: mathematik\nDescription: Mathe.\nTags: mathematik, math\nAge: 0'; };
  const { suggestion } = await suggestDetails({ ...project(text), headings: [], kind: 'quiz' }, { filename: 'main.html', language: 'German', ask });
  assert.deepEqual(suggestion, { title: 'Quiz: Frankreich, Spanien, Paris', type: 'quiz', subject: '', topic: '', description: 'Ein Quiz über die Hauptstadt von Frankreich und Spanien.', tags: ['Frankreich', 'Spanien', 'Paris'] });
});
