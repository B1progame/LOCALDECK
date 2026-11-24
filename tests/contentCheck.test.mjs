import test from 'node:test';
import assert from 'node:assert/strict';
import { checkContent, withOpinion } from '../src/services/contentCheck.ts';
import { isPlaceholderTitle, mergeTags, parseSuggestion, rateContent } from '../src/services/projectScan.ts';

const rating = (top, text = '', source) => checkContent({ top, text, source });

test('ordinary projects are not flagged', () => {
  for (const [top, text] of [
    ['Photosynthese Quiz Biologie', 'Wo findet die Photosynthese statt? Chloroplasten'],
    ['Snake', 'Score 0 Level 2 Game over'],
    ['Essex and Sussex', 'Middlesex is a county. The sextant measures angles.'],
    ['Vokabeln', 'sechs, sechzehn, 18 + 4 = 22, ab 1800'],
    ['Rechnen', '18+5 und 16+3 und 18 + 18'],
    ['Pokal', 'Der Jackpot der Tombola'],
  ]) assert.deepEqual([rating(top, text).rating, rating(top, text).reasons], ['ok', []], top);
});

test('lessons about a topic are not the topic', () => {
  assert.equal(rating('Fortpflanzung Biologie Lernzettel', 'Sex, Penis, Vagina, Orgasmus, nackt. Aufklärung in der Schule.').rating, 'ok');
  assert.equal(rating('Geschichte: Dreißigjähriger Krieg', 'Massaker, Folter, gefoltert, Massaker, Blutbad').rating, 'ok');
  assert.equal(rating('Drogen und Prävention', 'Kokain, Heroin, Cannabis, LSD').rating, 'ok');
});

test('adult content is flagged', () => {
  assert.deepEqual(rating('Hentai Galerie').rating, '18');
  assert.equal(rating('Gallery', 'porn xxx nsfw').rating, '18');
  assert.deepEqual([rating('Mein Spiel #18plus').rating, rating('Mein Spiel #18plus').reasons], ['18', ['marked']]);
  assert.equal(rating('Story 18+').rating, '18');
  assert.equal(rating('Film ab 18').rating, '18');
  assert.equal(rating('Story 16plus').rating, '16');
  assert.deepEqual(rating('Lucky', 'casino roulette with real money').reasons, ['gambling']);
  assert.equal(rating('Shooter', 'gore, torture and massacre, gore').rating, '16');
});

test('a password field is named', () => {
  assert.deepEqual(rating('Login', '', '<input name=p type="password">').reasons, ['password']);
});

test('erotic stories, horror and notes for adults are flagged', () => {
  assert.equal(rating('Nacht zu zweit', 'Sie war nackt. Ihr sexy Blick, dann hatten sie Sex.').rating, '16');
  assert.equal(rating('Zombie Horror', 'kill zombies, blood everywhere, the murderer').rating, '16');
  assert.equal(rating('Galerie', 'Nur für Erwachsene.').rating, '18');
  // Words of a game menu are no lesson.
  assert.equal(rating('Arena', 'History of scores. Health 100. gore, torture, gore').rating, '16');
});

test('the AI can raise the rating but not lower it, and lessons stay lessons', () => {
  const clean = rating('Card game', 'she takes off one more piece'), adult = rating('Hentai'), lesson = rating('Fortpflanzung', 'Befruchtung der Eizelle'), war = rating('Geschichte: Erster Weltkrieg', 'Schützengräben');
  const opinion = withOpinion(clean, ['sexual'], 'S');
  assert.deepEqual([opinion.rating, opinion.reasons, opinion.summary, opinion.rated], ['18', ['sexual', 'ai'], 'S', true]);
  assert.equal(withOpinion(clean, ['gambling', 'drugs'], '').rating, 'ok');
  assert.equal(withOpinion(rating('Wahrscheinlichkeit', 'Mathematik: Roulette als Beispiel'), ['gambling'], '').rating, 'ok');
  assert.deepEqual([withOpinion(rating('Slots', 'Spin and win'), ['gambling'], '').rating, withOpinion(clean, [], '').rating, withOpinion(clean, null, '').rated], ['16', 'ok', undefined]);
  assert.equal(withOpinion(adult, [], '').rating, '18');
  assert.deepEqual([withOpinion(lesson, ['sexual'], '').rating, withOpinion(war, ['violence'], '').rating, withOpinion(war, ['sexual'], '').rating], ['ok', 'ok', '18']);
});

test('every part is rated with plain questions', async () => {
  const asked = [];
  const ask = async messages => { const text = messages.at(-1).content; asked.push(text); return text.includes('erotic') ? (text.includes('part two') ? 'C' : 'A') : text.includes('part three') ? '**D**' : 'A = a normal topic'; };
  assert.deepEqual(await rateContent('T', ['part one', 'part two', 'part three'], ask), ['sexual', 'gambling']);
  assert.equal(asked.length, 5);
  assert.deepEqual(await rateContent('T', ['x'], async () => 'I am not sure'), []);
});

test('names that were missed in the test with the real model', () => {
  assert.equal(rating('Strip Poker', 'she takes off one more piece').rating, '18');
  assert.equal(withOpinion(rating('Erster Weltkrieg', 'Massaker, Waffen, Blut'), ['violence'], '').rating, 'ok');
});

test('an age line does not become a hashtag', () => {
  assert.deepEqual(parseSuggestion('Name: X\nTags: one, two\nAge: 18').tags, ['one', 'two']);
});

test('existing hashtags stay, meaningless names are found', () => {
  assert.deepEqual(mergeTags(['html', 'Eine lange eigene Markierung'], ['HTML', 'neu']), ['html', 'Eine lange eigene Markierung', 'neu']);
  assert.equal(mergeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], ['x', 'y', 'z']).length, 10);
  for (const title of ['index', 'Untitled project', 'index (2)', 'neu 3']) assert.ok(isPlaceholderTitle(title), title);
  for (const title of ['Vektoren', 'Index der Könige', 'Testament']) assert.ok(!isPlaceholderTitle(title), title);
});
