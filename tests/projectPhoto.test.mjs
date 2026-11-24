import test from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_SANDBOX, PHOTO_SCRIPT, photoScore, resolvePath, startButton, waitsForPlayer } from '../src/services/projectPhoto.ts';
import { importantTags } from '../src/services/projectScan.ts';

test('the start button is found, others are never pressed', () => {
  assert.equal(startButton(['Help', '▶ Start driving', 'Share']), 1);
  assert.equal(startButton(['Spiel starten']), 0);
  assert.equal(startButton(['Einstellungen', 'Los geht’s!']), 1);
  assert.equal(startButton(['Commencer']), 0);
  assert.equal(startButton(['Restart', 'Start over and delete all', 'Login', 'Download']), -1);
  assert.equal(startButton([]), -1);
  assert.deepEqual([['Drive again'], ['Start'], ['Pause']].map(waitsForPlayer), [true, true, false]);
});

test('a photo with something to see scores higher than an empty one', () => {
  const make = paint => { const pixels = []; for (let y = 0; y < 40; y++) for (let x = 0; x < 64; x++) pixels.push(...paint(x, y), 255); return photoScore(pixels, 64); };
  const empty = make(() => [10, 10, 10]), page = make((x, y) => y === 5 && x < 20 ? [240, 240, 240] : [10, 10, 10]), game = make((x, y) => [(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256]);
  assert.ok(empty < .05, String(empty));
  assert.ok(page > empty && game > page, `${empty} ${page} ${game}`);
});

test('file references are resolved like in a browser', () => {
  assert.equal(resolvePath('index.html', './img/a.png?v=2#x'), 'img/a.png');
  assert.equal(resolvePath('css/style.css', '../img/b%20c.png'), 'img/b c.png');
  assert.equal(resolvePath('pages/index.html', '/root.js'), 'root.js');
});

test('the script of the frame is valid, and the frame may only run scripts', () => {
  assert.equal(typeof new Function(`return ${PHOTO_SCRIPT}`)(), 'function');
  assert.ok(!/<\/script/i.test(PHOTO_SCRIPT));
  assert.equal(PHOTO_SANDBOX, 'allow-scripts');
});

test('kind, subject, topic and keywords become hashtags, at most ten', () => {
  const suggestion = { title: 'X', type: 'quiz', subject: 'Biologie', topic: 'Fotosynthese', description: '', tags: ['Chlorophyll', 'biologie', 'Licht', 'Wasser', 'Zucker', 'Blatt', 'Sauerstoff', 'Pflanze', 'Stärke'] };
  const tags = importantTags([], suggestion, 'Quiz');
  assert.deepEqual(tags, ['Biologie', 'Quiz', 'Fotosynthese', 'Chlorophyll', 'Licht', 'Wasser', 'Zucker', 'Blatt', 'Sauerstoff', 'Pflanze']);
  assert.deepEqual(importantTags(['meins'], { ...suggestion, tags: [] }, 'Quiz'), ['meins', 'Biologie', 'Quiz', 'Fotosynthese']);
  const full = Array.from({ length: 12 }, (_, i) => `t${i}`);
  assert.deepEqual(importantTags(full, suggestion, 'Quiz'), full);
});
