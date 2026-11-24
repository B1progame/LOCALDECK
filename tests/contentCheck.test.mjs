import test from 'node:test';
import assert from 'node:assert/strict';
import { checkContent, withOpinion } from '../src/services/contentCheck.ts';
import { isPlaceholderTitle, mergeTags, parseAge, parseSuggestion } from '../src/services/projectScan.ts';

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

test('the AI can raise the rating but not lower it', () => {
  const clean = rating('Vulkan Quiz', 'Was ist Magma?'), adult = rating('Hentai'), mild = rating('Zombie night', 'kill the zombie, blood'), casino = rating('Lucky', 'casino roulette');
  // Without any sign in the project the AI is not believed.
  assert.deepEqual([withOpinion(clean, 18, 'S').rating, withOpinion(clean, 18, 'S').reasons, withOpinion(clean, 18, 'S').summary], ['ok', [], 'S']);
  assert.deepEqual([mild.rating, withOpinion(mild, 18, '').rating, withOpinion(mild, 18, '').reasons, withOpinion(mild, 0, '').rating], ['ok', '16', ['ai'], 'ok']);
  assert.deepEqual([casino.rating, withOpinion(casino, 18, '').rating], ['16', '18']);
  assert.equal(withOpinion(rating('Geschichte Quiz', 'Mord und Blut'), 18, '').rating, 'ok');
  assert.equal(withOpinion(adult, 0, '').rating, '18');
  assert.deepEqual([withOpinion(clean, null, '').rating, withOpinion(clean, 6, '').rating], ['ok', 'ok']);
});

test('the age line is read and does not become a hashtag', () => {
  const answer = 'Name: X\nTags: one, two\nAge: 18';
  assert.equal(parseAge(answer), 18);
  assert.equal(parseAge('**Alter:** ab 16'), 16);
  assert.equal(parseAge('Age: none'), null);
  assert.equal(parseAge('Name: The stone age: 12 facts'), null);
  assert.deepEqual(parseSuggestion(answer).tags, ['one', 'two']);
});

test('existing hashtags stay, meaningless names are found', () => {
  assert.deepEqual(mergeTags(['html', 'Eine lange eigene Markierung'], ['HTML', 'neu']), ['html', 'Eine lange eigene Markierung', 'neu']);
  assert.equal(mergeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], ['x']).length, 9);
  for (const title of ['index', 'Untitled project', 'index (2)', 'neu 3']) assert.ok(isPlaceholderTitle(title), title);
  for (const title of ['Vektoren', 'Index der Könige', 'Testament']) assert.ok(!isPlaceholderTitle(title), title);
});
