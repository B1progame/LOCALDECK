import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function localdeckPrecache() {
  let emitted: string[] = [];
  // Only the local AI needs these (about 29 MB). The service worker keeps them on first use, not for everyone.
  const onDemand = /ort-wasm|^assets\/(worker|small|wllama)-/;
  return {
    name: 'localdeck-offline-shell',
    apply: 'build' as const,
    generateBundle(_options: unknown, bundle: Record<string, { type: string; fileName: string }>) {
      emitted = Object.values(bundle).map(entry => entry.fileName).filter(name => !name.endsWith('.map') && !onDemand.test(name));
    },
    async writeBundle(options: { dir?: string }) {
      const outDir = options.dir ?? 'dist';
      const source = await readFile(path.resolve('public/sw.js'), 'utf8');
      const precache = JSON.stringify(emitted.map(file => file.replaceAll('\\', '/')));
      await writeFile(path.join(outDir, 'sw.js'), source.replace('__LOCALDECK_PRECACHE__', precache));
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/LOCALDECK/' : '/',
  plugins: [react(), localdeckPrecache()],
  server: { host: 'localhost', port: 5468, strictPort: true },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true },
}));
