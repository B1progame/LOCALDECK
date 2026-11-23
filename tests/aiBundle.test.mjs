import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectPrompt, parseBundle } from '../src/services/aiBundle.ts';

test('parses LocalDeck file markers, including base64 images and stray code fences', async () => {
  const answer = `Here is your project!

=== LOCALDECK FILE: index.html ===
\`\`\`html
<!doctype html><html><body><img src="cover.svg"></body></html>
\`\`\`
=== END FILE ===

=== LOCALDECK FILE: localdeck.json ===
{"schemaVersion":1,"title":"Mars Lab","type":"simulation","cover":"cover.svg"}
=== END FILE ===

**=== LOCALDECK FILE: cover.svg ===**
<svg xmlns="http://www.w3.org/2000/svg"></svg>
=== END FILE ===

=== LOCALDECK FILE: img/dot.png (base64) ===
iVBORw0KGgo=
=== END FILE ===`;
  const { files, warnings } = parseBundle(answer);
  assert.deepEqual(files.map(f => f.path).sort(), ['cover.svg', 'img/dot.png', 'index.html', 'localdeck.json']);
  assert.equal(warnings.length, 0);
  const html = await files.find(f => f.path === 'index.html').blob.text();
  assert.ok(html.startsWith('<!doctype html>'), 'code fence removed');
  const png = new Uint8Array(await files.find(f => f.path === 'img/dot.png').blob.arrayBuffer());
  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('falls back to filename + code block answers and rejects unsafe paths', () => {
  const answer = '**index.html**\n```html\n<!doctype html><p>Hi</p>\n```\n\n`style.css`:\n```css\np{color:red}\n```\n\n=== LOCALDECK FILE: ../evil.js ===\nx\n=== END FILE ===';
  const markers = parseBundle(answer);
  assert.equal(markers.files.length, 0);
  assert.match(markers.warnings[0], /unsafe/);
  const fallback = parseBundle('**index.html**\n```html\n<!doctype html><p>Hi</p>\n```\n\n`style.css`:\n```css\np{color:red}\n```');
  assert.deepEqual(fallback.files.map(f => f.path).sort(), ['index.html', 'style.css']);
});

test('project prompt asks for offline files and the bundle format', () => {
  const prompt = buildProjectPrompt({ idea: 'A fractions trainer', kind: 'learning', subject: 'Mathematik', language: 'Deutsch' });
  assert.match(prompt, /=== LOCALDECK FILE: index\.html ===/);
  assert.match(prompt, /offline/i);
  assert.match(prompt, /Mathematik/);
});

import { missingRules, passwordProblem } from '../src/services/passwordPolicy.ts';
test('password rules match the Firebase policy', () => {
  assert.deepEqual(missingRules('short'), ['12+ characters', 'an uppercase letter', 'a symbol like ! ? # @']);
  assert.equal(passwordProblem('Correct-Horse-Battery'), null);
  assert.match(passwordProblem('alllowercaseletters'), /uppercase/);
});
