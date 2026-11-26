/* npm run licenses
   Writes public/licenses.txt: the licenses of the software that is part of the website. MIT, BSD, ISC, Apache and OFL
   ask that their text and the names of the authors go with every copy. Run it again after changing a dependency. */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const npm = process.platform === 'win32' ? ['cmd', ['/c', 'npm']] : ['npm', []];
const tree = JSON.parse(execFileSync(npm[0], [...npm[1], 'ls', '--omit=dev', '--all', '--json', '--long'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
const packages = new Map();
const visit = node => {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    const folder = entry.path;
    if (!folder || !existsSync(path.join(folder, 'package.json'))) continue;
    const info = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8'));
    const key = `${info.name}@${info.version}`;
    if (!packages.has(key) && info.name !== 'localdeck-empty') packages.set(key, { ...info, name: info.name ?? name, folder });
    visit(entry);
  }
};
visit(tree);

const person = value => typeof value === 'string' ? value : value?.name ?? '';
const texts = folder => readdirSync(folder).filter(file => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(file)).sort().map(file => readFileSync(path.join(folder, file), 'utf8').replace(/\r\n/g, '\n').trim()).filter(Boolean);
/** Packages that name their license but do not contain its text. */
const MIT = owner => `MIT License\n\nCopyright (c) ${owner}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ISC = owner => `ISC License\n\nCopyright (c) ${owner}\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;
const APACHE = [...packages.values()].flatMap(info => texts(info.folder)).find(text => /Apache License\s+Version 2\.0/.test(text) && text.includes('END OF TERMS AND CONDITIONS')) ?? '';

const groups = new Map();
const add = (text, who) => groups.set(text, [...(groups.get(text) ?? []), who]);
for (const [key, info] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const license = typeof info.license === 'string' ? info.license : info.license?.type ?? 'unknown';
  const who = `${key} (${license})${person(info.author) ? `, ${person(info.author)}` : ''}`;
  const found = texts(info.folder);
  const owner = person(info.author) || (info.name.startsWith('onnxruntime') ? 'Microsoft Corporation' : `the authors of ${info.name}`);
  add(found.length ? found.join('\n\n') : license === 'MIT' ? MIT(owner) : license === 'ISC' ? ISC(owner) : license === 'Apache-2.0' && APACHE ? APACHE : `This package is under the license ${license}. Its text: https://spdx.org/licenses/${license}.html`, who);
}
add(MIT('2023-2026 The ggml authors'), 'llama.cpp, part of @wllama/wllama (MIT)');

const line = '='.repeat(78);
const head = `LocalDeck: licenses of the software it is built with\n\nLocalDeck itself: Copyright (c) 2026 B1progame, all rights reserved.\nhttps://github.com/B1progame/LOCALDECK/blob/main/LICENSE.md\n\nThe parts below belong to their authors and are used under their licenses.\nThe AI models are loaded from Hugging Face and listed at\nhttps://github.com/B1progame/LOCALDECK/blob/main/docs/LICENSES.md\n`;
const body = [...groups].map(([text, names]) => `${line}\n${names.join('\n')}\n${line}\n\n${text}\n`).join('\n');
writeFileSync('public/licenses.txt', `${head}\n${body}`);
console.log(`${packages.size} packages, ${groups.size} texts, ${Math.round(body.length / 1024)} KB`);
