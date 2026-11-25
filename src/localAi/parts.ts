/* Loads a very large file in parts and keeps every part in the browser's cache. A lost connection or a closed page
   then costs only the last part, not the whole file. */
export const PART_BYTES = 16 * 1024 * 1024;

export type PartCache = Pick<Cache, 'match' | 'put'> & { keys?: Cache['keys'] };
type Options = { cache: PartCache | null; fetcher?: typeof fetch; wait?: (ms: number) => Promise<void>; size?: number };

const partKey = (url: string, index: number) => `${url}?localdeck-part=${index}`;
const sizeKey = (url: string) => `${url}?localdeck-size`;
/** Pauses before another try. Together about a minute, enough for a change of network. */
const PAUSES = [1000, 2000, 5000, 10_000, 20_000, 20_000];

async function knownSize(url: string, cache: PartCache | null): Promise<number> {
  try { return Number(await (await cache?.match(sizeKey(url)))?.text()) || 0; } catch { return 0; }
}

async function loadPart(url: string, index: number, total: number, { cache, fetcher = fetch, wait = ms => new Promise(resolve => { setTimeout(resolve, ms); }), size = PART_BYTES }: Options): Promise<{ bytes: Uint8Array; total: number }> {
  const start = index * size, expected = total ? Math.min(size, total - start) : 0;
  try {
    const saved = total ? await cache?.match(partKey(url, index)) : undefined;
    if (saved) { const bytes = new Uint8Array(await saved.arrayBuffer()); if (bytes.length === expected) return { bytes, total }; }
  } catch { /* an unreadable part is loaded again */ }
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetcher(url, { headers: { Range: `bytes=${start}-${start + size - 1}` } });
      if (response.status !== 206) throw new Error(`Part failed to load: http ${response.status}`);
      const all = total || Number(response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1] ?? 0);
      if (!all) throw new Error('network: the size of the file is unknown');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== Math.min(size, all - start)) throw new Error('network: a part arrived incomplete');
      // Without free space it still works, the part is only loaded again next time.
      try { if (!total) await cache?.put(sizeKey(url), new Response(String(all))); await cache?.put(partKey(url, index), new Response(bytes as Uint8Array<ArrayBuffer>)); } catch { /* no space */ }
      return { bytes, total: all };
    } catch (error) {
      if (attempt >= PAUSES.length) throw error;
      await wait(PAUSES[attempt]!);
    }
  }
}

/** Looks like a normal download of the whole file. */
export async function loadInParts(url: string, options: Options): Promise<Response> {
  const size = options.size ?? PART_BYTES, known = await knownSize(url, options.cache);
  const first = await loadPart(url, 0, known, options), total = first.total, count = Math.ceil(total / size);
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        controller.enqueue(index === 0 ? first.bytes : (await loadPart(url, index, total, options)).bytes);
        if (++index >= count) controller.close();
      } catch (error) { controller.error(error); }
    },
  }, { highWaterMark: 1 });
  return new Response(stream, { status: 200, headers: { 'content-length': String(total) } });
}

/** How much of the large files is already in the cache, from 0 to 1. A file that was stored whole counts, too. */
export async function storedShare(cache: PartCache, size = PART_BYTES): Promise<number> {
  const urls = (await cache.keys?.() ?? []).map(request => request.url);
  let best = 0;
  for (const url of urls) {
    if (/\.onnx_data$/.test(url)) return 1;
    if (!url.endsWith('?localdeck-size')) continue;
    const file = url.slice(0, -'?localdeck-size'.length), total = await knownSize(file, cache);
    if (total) best = Math.max(best, urls.filter(entry => entry.startsWith(`${file}?localdeck-part=`)).length / Math.ceil(total / size));
  }
  return Math.min(1, best);
}
