/* AI studio → Package builder.
   Turns the HTML an AI produced (plus images and other files) into a finished LocalDeck ZIP:
   index.html + localdeck.json + cover image + assets, checked for missing references. */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, Check, FileCode2, FileText, Image as ImageIcon, LoaderCircle, PackageCheck, Paperclip, Plus, Sparkles, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import { analyzeFiles, diagnoseCompatibility } from './services/importer';
import { createItem } from './services/library';
import { createStoredZip, normalizePackagePath } from './services/zip';
import { CONTENT_TYPES, type ContentType, type LibraryItem, type ProjectManifest } from './types';
import { TYPE_ICON, TYPE_LABEL, bytes, generatedCoverImage, go } from './shared';

type Extra = { path: string; file: Blob; url?: string };
type Notify = (message: string, error?: boolean) => void;

const slug = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

/** Renders LocalDeck's generated artwork plus the title into a 1200×750 PNG. */
async function renderCover(title: string, type: ContentType, subject: string): Promise<Blob> {
  const css = generatedCoverImage({ title, type, subject } as LibraryItem);
  const src = decodeURIComponent(css.slice(css.indexOf('data:image/svg+xml,') + 19, css.lastIndexOf('")')));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
  await img.decode();
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 750;
  const g = canvas.getContext('2d')!;
  g.drawImage(img, 0, 0, 1200, 750);
  const shade = g.createLinearGradient(0, 300, 0, 750); shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = shade; g.fillRect(0, 0, 1200, 750);
  g.fillStyle = '#fff'; g.font = '700 64px Inter, system-ui, sans-serif'; g.textBaseline = 'bottom';
  const words = title.split(/\s+/); const lines: string[] = []; let line = '';
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (g.measureText(next).width > 640 && line) { lines.push(line); line = word; } else line = next; }
  lines.push(line);
  lines.slice(-3).forEach((text, i, arr) => g.fillText(text, 60, 750 - 90 - (arr.length - 1 - i) * 72));
  g.font = '600 30px Inter, system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.8)';
  g.fillText(subject || TYPE_LABEL[type], 60, 750 - 44);
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Cover could not be rendered.')), 'image/png'));
}

export function PackageBuilder({ notify, onAdded }: { notify: Notify; onAdded: () => Promise<void> }) {
  const [html, setHtml] = useState('');
  const [htmlName, setHtmlName] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [cover, setCover] = useState<{ blob: Blob; url: string; name: string; generated: boolean } | null>(null);
  const [meta, setMeta] = useState({ title: '', type: 'learning' as ContentType, subject: '', topic: '', genre: '', description: '', tags: '', language: '', orientation: 'any' as 'any' | 'portrait' | 'landscape' });
  const [busy, setBusy] = useState<'' | 'zip' | 'library' | 'cover'>('');
  const [progress, setProgress] = useState(0);
  const htmlInput = useRef<HTMLInputElement>(null);
  const extraInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover.url); }, [cover]);

  const readHtml = async (file: File) => {
    if (!/\.html?$/i.test(file.name)) { notify('Choose an .html file for the project code.', true); return; }
    const text = await file.text();
    setHtml(text); setHtmlName(file.name); setPasteMode(false);
    // Prefill from <title> or an embedded manifest so the user rarely has to type.
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const embedded = doc.querySelector('script#localdeck-manifest');
    let manifest: Partial<ProjectManifest> = {};
    try { manifest = embedded?.textContent ? JSON.parse(embedded.textContent) as Partial<ProjectManifest> : {}; } catch { /* ignore */ }
    setMeta(m => ({
      ...m,
      title: m.title || manifest.title || doc.title || file.name.replace(/\.html?$/i, ''),
      type: manifest.type && CONTENT_TYPES.includes(manifest.type) ? manifest.type : m.type,
      subject: m.subject || manifest.subject || '', topic: m.topic || manifest.topic || '', genre: m.genre || manifest.genre || '',
      description: m.description || manifest.description || doc.querySelector('meta[name="description"]')?.getAttribute('content') || '',
      tags: m.tags || (manifest.tags ?? []).join(', '), language: m.language || manifest.language || doc.documentElement.lang || '',
    }));
  };

  const addExtras = (files: FileList | null) => {
    if (!files) return;
    const next = [...extras];
    for (const file of Array.from(files)) {
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      let path = relative ? relative.split('/').slice(1).join('/') : file.name;
      try { path = normalizePackagePath(path); } catch { notify(`Skipped ${file.name}: unsafe file name.`, true); continue; }
      if (/^index\.html?$/i.test(path) || path === 'localdeck.json') { notify(`${path} is created automatically and was skipped.`); continue; }
      const index = next.findIndex(e => e.path.toLowerCase() === path.toLowerCase());
      const entry = { path, file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined };
      if (index >= 0) next[index] = entry; else next.push(entry);
    }
    setExtras(next);
  };

  const chooseCover = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify('Choose a PNG, JPG, WebP or SVG image for the cover.', true); return; }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    setCover({ blob: file, url: URL.createObjectURL(file), name: `cover.${ext}`, generated: false });
  };

  const generateCover = async () => {
    setBusy('cover');
    try { const blob = await renderCover(meta.title || 'Untitled project', meta.type, meta.subject || meta.genre); setCover({ blob, url: URL.createObjectURL(blob), name: 'cover.png', generated: true }); }
    catch (error) { notify(error instanceof Error ? error.message : 'Cover could not be generated.', true); }
    finally { setBusy(''); }
  };

  const manifest: ProjectManifest = useMemo(() => ({
    schemaVersion: 1, title: meta.title.trim() || 'Untitled project', type: meta.type, format: 'html', entry: 'index.html',
    ...(meta.description.trim() ? { description: meta.description.trim() } : {}),
    ...(meta.subject.trim() ? { subject: meta.subject.trim() } : {}),
    ...(meta.topic.trim() ? { topic: meta.topic.trim() } : {}),
    ...(meta.genre.trim() ? { genre: meta.genre.trim() } : {}),
    ...(meta.tags.trim() ? { tags: meta.tags.split(',').map(t => t.trim()).filter(Boolean) } : {}),
    ...(meta.language.trim() ? { language: meta.language.trim() } : {}),
    ...(meta.orientation !== 'any' ? { preferredOrientation: meta.orientation } : {}),
    ...(cover ? { cover: cover.name } : {}),
    offlineIntent: true,
  }), [meta, cover]);

  const paths = useMemo(() => ['index.html', 'localdeck.json', ...(cover ? [cover.name] : []), ...extras.map(e => e.path)], [cover, extras]);
  const report = useMemo(() => html ? diagnoseCompatibility(html, paths, 'index.html') : null, [html, paths]);
  const totalSize = useMemo(() => new Blob([html]).size + (cover?.blob.size ?? 0) + extras.reduce((s, e) => s + e.file.size, 0), [html, cover, extras]);
  const ready = Boolean(html.trim()) && Boolean(meta.title.trim());

  const buildZip = async (): Promise<Blob> => {
    const enc = new TextEncoder();
    const entries: Array<{ path: string; data: Uint8Array }> = [
      { path: 'index.html', data: enc.encode(html) },
      { path: 'localdeck.json', data: enc.encode(JSON.stringify(manifest, null, 2)) },
    ];
    setProgress(.2);
    if (cover) entries.push({ path: cover.name, data: new Uint8Array(await cover.blob.arrayBuffer()) });
    for (let i = 0; i < extras.length; i++) { entries.push({ path: extras[i]!.path, data: new Uint8Array(await extras[i]!.file.arrayBuffer()) }); setProgress(.2 + .7 * (i + 1) / extras.length); }
    const zip = createStoredZip(entries); setProgress(1);
    return zip;
  };

  const download = async () => {
    setBusy('zip'); setProgress(0);
    try {
      const zip = await buildZip();
      const a = document.createElement('a'); a.href = URL.createObjectURL(zip); a.download = `${slug(manifest.title)}.zip`; a.click(); window.setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      notify(`${manifest.title}.zip is ready · ${bytes(zip.size)}`);
    } catch (error) { notify(error instanceof Error ? error.message : 'The ZIP could not be created.', true); }
    finally { setBusy(''); }
  };

  const addToLibrary = async () => {
    setBusy('library'); setProgress(0);
    try {
      const zip = await buildZip();
      const [preview] = await analyzeFiles([new File([zip], `${slug(manifest.title)}.zip`, { type: 'application/zip' })]);
      if (!preview) throw new Error('The package could not be read back.');
      const item = await createItem(preview);
      await onAdded();
      notify(`“${item.title}” was added to your library.`);
      go('item', `/${encodeURIComponent(item.id)}`);
    } catch (error) { notify(error instanceof Error ? error.message : 'The project could not be added.', true); }
    finally { setBusy(''); }
  };

  const set = <K extends keyof typeof meta>(key: K, value: (typeof meta)[K]) => setMeta(m => ({ ...m, [key]: value }));
  const TypeIcon = TYPE_ICON[meta.type];
  const step = (n: number, done: boolean) => <span className={`step-dot ${done ? 'done' : ''}`}>{done ? <Check size={13}/> : n}</span>;

  return <section className="panel package-builder" aria-labelledby="pb-title">
    <div className="panel-heading"><span className="panel-icon violet"><PackageCheck size={18}/></span><div><h2 id="pb-title">Package builder</h2><p>Bring the HTML your AI made, add images and files, and get a finished LocalDeck ZIP with cover, manifest and every asset.</p></div></div>
    <div className="pb-grid">
      <div className="pb-steps">
        <div className="pb-step">
          <h3>{step(1, Boolean(html))} Project code</h3>
          {!pasteMode ? <button type="button" className={`pb-drop ${html ? 'filled' : ''}`} onClick={() => htmlInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void readHtml(f); }}>
            {html ? <><FileCode2 size={20}/><b>{htmlName || 'Pasted code'}</b><small>{bytes(new Blob([html]).size)} · becomes index.html · click to replace</small></> : <><Upload size={20}/><b>Drop the HTML file here</b><small>or click to choose it</small></>}
          </button> : <textarea className="pb-paste" value={html} onChange={e => { setHtml(e.target.value); setHtmlName('Pasted code'); }} onBlur={() => { if (!html.trim()) return; const doc = new DOMParser().parseFromString(html, 'text/html'); setMeta(m => ({ ...m, title: m.title || doc.title.trim(), description: m.description || doc.querySelector('meta[name="description"]')?.getAttribute('content') || '', language: m.language || doc.documentElement.lang || '' })); }} placeholder="<!doctype html>…" spellCheck={false}/>}
          <input ref={htmlInput} type="file" accept=".html,.htm,text/html" className="visually-hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readHtml(f); }}/>
          <button type="button" className="text-button" onClick={() => setPasteMode(v => !v)}>{pasteMode ? 'Choose a file instead' : 'Paste code instead'}</button>
        </div>

        <div className="pb-step">
          <h3>{step(2, Boolean(cover))} Cover image</h3>
          <div className="pb-cover-row">
            <button type="button" className="button" onClick={() => coverInput.current?.click()}><ImageIcon size={15}/> Choose image</button>
            <button type="button" className="button subtle" onClick={() => void generateCover()} disabled={busy === 'cover'}>{busy === 'cover' ? <LoaderCircle size={15} className="spin"/> : <Wand2 size={15}/>} Generate cover</button>
            {cover && <button type="button" className="icon-button" aria-label="Remove cover" onClick={() => setCover(null)}><X size={16}/></button>}
          </div>
          <input ref={coverInput} type="file" accept="image/*" className="visually-hidden" onChange={e => { chooseCover(e.target.files?.[0]); e.target.value = ''; }}/>
          <small className="muted-text">{cover ? `${cover.name} · ${bytes(cover.blob.size)}${cover.generated ? ' · generated from your title' : ''}` : 'Use the image your AI made, or generate one from the title.'}</small>
        </div>

        <div className="pb-step">
          <h3>{step(3, extras.length > 0)} Extra files <span className="muted-text">optional</span></h3>
          <div className="pb-cover-row">
            <button type="button" className="button" onClick={() => extraInput.current?.click()}><Paperclip size={15}/> Add files</button>
            <span className="muted-text">Images, sounds, scripts, styles, data — keep the names your HTML uses.</span>
          </div>
          <input ref={extraInput} type="file" multiple className="visually-hidden" onChange={e => { addExtras(e.target.files); e.target.value = ''; }}/>
          {extras.length > 0 && <div className="file-list pb-files">{extras.map(e => <div key={e.path} className="file-row">{e.url ? <img src={e.url} alt="" className="pb-thumb"/> : <FileText size={15}/>}<span>{e.path}</span><small>{bytes(e.file.size)}</small><button type="button" className="icon-button" aria-label={`Remove ${e.path}`} onClick={() => setExtras(list => list.filter(x => x.path !== e.path))}><Trash2 size={14}/></button></div>)}</div>}
        </div>

        <div className="pb-step">
          <h3>{step(4, Boolean(meta.title.trim()))} Details</h3>
          <div className="pb-fields">
            <label className="form-field pb-wide"><span>Title</span><input value={meta.title} onChange={e => set('title', e.target.value)} maxLength={120} placeholder="e.g. Ableitungen verstehen"/></label>
            <label className="form-field"><span>Type</span><select value={meta.type} onChange={e => set('type', e.target.value as ContentType)}>{CONTENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
            <label className="form-field"><span>{meta.type === 'game' || meta.type === 'app' || meta.type === 'tool' ? 'Genre or category' : 'Subject'}</span>{meta.type === 'game' || meta.type === 'app' || meta.type === 'tool' ? <input value={meta.genre} onChange={e => set('genre', e.target.value)} placeholder="e.g. Arcade"/> : <input value={meta.subject} onChange={e => set('subject', e.target.value)} placeholder="e.g. Mathematik"/>}</label>
            <label className="form-field"><span>Topic</span><input value={meta.topic} onChange={e => set('topic', e.target.value)} placeholder="optional"/></label>
            <label className="form-field"><span>Language</span><input value={meta.language} onChange={e => set('language', e.target.value)} placeholder="e.g. de"/></label>
            <label className="form-field pb-wide"><span>Description</span><textarea rows={2} value={meta.description} onChange={e => set('description', e.target.value)} placeholder="One or two sentences about what it does"/></label>
            <label className="form-field"><span>Tags, comma separated</span><input value={meta.tags} onChange={e => set('tags', e.target.value)}/></label>
            <label className="form-field"><span>Orientation</span><select value={meta.orientation} onChange={e => set('orientation', e.target.value as typeof meta.orientation)}><option value="any">Any</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
          </div>
        </div>
      </div>

      <aside className="pb-preview">
        <div className="pb-card">
          <div className="pb-card-cover" style={{ backgroundImage: cover ? `url("${cover.url}")` : generatedCoverImage({ title: meta.title || 'Untitled project', type: meta.type, subject: meta.subject || meta.genre } as LibraryItem) }}>
            <span className="cover-type"><TypeIcon size={17}/></span>
            {!cover && <span className="pb-card-title">{meta.title || 'Untitled project'}</span>}
          </div>
          <div className="pb-card-info"><b>{meta.title || 'Untitled project'}</b><small>{[TYPE_LABEL[meta.type], meta.subject || meta.genre].filter(Boolean).join(' · ')}</small></div>
        </div>
        <div className="pb-check">
          <h3>Package check</h3>
          {!html ? <p className="muted-text">Add the HTML to see what’s inside and what’s missing.</p> : <>
            <div className={`status-pill ${report?.score}`}><Sparkles size={14}/>{report?.score === 'likely' ? 'Ready to work offline' : 'Needs a look'}</div>
            <ul className="finding-list">{report?.findings.map(f => <li key={f}>{f}</li>)}</ul>
            <div className="pb-tree">{paths.map(p => <code key={p}>{p}</code>)}</div>
            <small className="muted-text">{paths.length} files · about {bytes(totalSize)}</small>
          </>}
        </div>
        {busy && busy !== 'cover' && <div className="progress-bar determinate"><i style={{ width: `${Math.round(progress * 100)}%` }}/></div>}
        <button className="button primary pb-action" disabled={!ready || Boolean(busy)} onClick={() => void download()}>{busy === 'zip' ? <LoaderCircle size={16} className="spin"/> : <ArrowDownToLine size={16}/>} Download ZIP</button>
        <button className="button pb-action" disabled={!ready || Boolean(busy)} onClick={() => void addToLibrary()}>{busy === 'library' ? <LoaderCircle size={16} className="spin"/> : <Plus size={16}/>} Add to my library</button>
        {!ready && <small className="muted-text">Add the HTML and a title to export.</small>}
      </aside>
    </div>
  </section>;
}
