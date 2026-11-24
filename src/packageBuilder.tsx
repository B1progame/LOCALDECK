/* AI studio → Package builder.
   Turns the HTML an AI produced (plus images and other files) into a finished LocalDeck ZIP:
   index.html + localdeck.json + cover image + assets, checked for missing references. */
import { plural, t, tm } from './i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, Bot, Check, ClipboardPaste, Copy, FileArchive, FileCode2, FileText, Image as ImageIcon, LoaderCircle, PackageCheck, Paperclip, Plus, Sparkles, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import { analyzeFiles, diagnoseCompatibility, isJunkPath } from './services/importer';
import { buildProjectPrompt, parseBundle, type BundleFile, type PromptKind } from './services/aiBundle';
import { createItem } from './services/library';
import { createStoredZip, normalizePackagePath, readZip } from './services/zip';
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
  const [busy, setBusy] = useState<'' | 'zip' | 'library' | 'cover' | 'read'>('');
  const [source, setSource] = useState<'' | 'ask' | 'paste'>('');
  const [answer, setAnswer] = useState('');
  const [idea, setIdea] = useState('');
  const [promptKind, setPromptKind] = useState<PromptKind>('learning');
  const [loadNote, setLoadNote] = useState<string[]>([]);
  const zipInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const htmlInput = useRef<HTMLInputElement>(null);
  const extraInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover.url); }, [cover]);

  /** Fills the whole builder from a set of files (an AI bundle or a ZIP). */
  const loadFiles = async (input: BundleFile[], origin: string) => {
    let files = input.filter(f => !isJunkPath(f.path));
    const first = files[0]?.path.split('/')[0];
    if (first && files.length > 1 && files.every(f => f.path.startsWith(`${first}/`))) files = files.map(f => ({ ...f, path: f.path.slice(first.length + 1) }));
    const byPath = new Map(files.map(f => [f.path.toLowerCase(), f]));
    let manifest: Partial<ProjectManifest> = {};
    const manifestFile = byPath.get('localdeck.json');
    if (manifestFile) { try { manifest = JSON.parse(await manifestFile.blob.text()) as Partial<ProjectManifest>; } catch { /* reported by the package check */ } }
    const entryPath = (manifest.entry && byPath.has(manifest.entry.toLowerCase()) ? manifest.entry : files.find(f => /^index\.html?$/i.test(f.path))?.path ?? files.find(f => /\.html?$/i.test(f.path))?.path) ?? '';
    const entry = byPath.get(entryPath.toLowerCase());
    if (!entry) { notify(t('No HTML page was found in the {0}.', origin), true); return; }
    const text = await entry.blob.text();
    const coverPath = (manifest.cover && byPath.has(manifest.cover.replace(/^\.\//, '').toLowerCase()) ? manifest.cover.replace(/^\.\//, '') : files.find(f => /^cover\.(png|jpe?g|webp|svg|avif)$/i.test(f.path))?.path) ?? '';
    const coverFile = coverPath ? byPath.get(coverPath.toLowerCase()) : undefined;
    setHtml(text); setHtmlName(t('{0} from {1}', entry.path, origin)); setPasteMode(false);
    setCover(coverFile ? { blob: coverFile.blob, url: URL.createObjectURL(coverFile.blob), name: coverFile.path, generated: false } : null);
    setExtras(files.filter(f => f !== entry && f !== manifestFile && f !== coverFile).map(f => ({ path: f.path, file: f.blob, url: f.blob.type.startsWith('image/') ? URL.createObjectURL(f.blob) : undefined })));
    const doc = new DOMParser().parseFromString(text, 'text/html');
    setMeta(m => ({
      ...m,
      title: manifest.title || doc.title || m.title,
      type: manifest.type && CONTENT_TYPES.includes(manifest.type) ? manifest.type : m.type,
      subject: manifest.subject ?? m.subject, topic: manifest.topic ?? m.topic, genre: manifest.genre ?? m.genre,
      description: manifest.description ?? m.description, tags: manifest.tags?.join(', ') ?? m.tags, language: manifest.language ?? (doc.documentElement.lang || m.language),
      orientation: manifest.preferredOrientation ?? m.orientation,
    }));
    if (entry.path !== 'index.html') setLoadNote(n => [...n, t('{0} will be saved as index.html. Links to it from other pages may need updating.', entry.path)]);
    notify(plural(files.length, 'Loaded {0} file from the {1}.', 'Loaded {0} files from the {1}.', files.length, origin));
  };

  const importAnswer = async () => {
    const { files, warnings } = parseBundle(answer);
    setLoadNote(warnings);
    if (!files.length) { notify(t('No project files were found in that answer. Ask the AI to use the LocalDeck file format from the prompt.'), true); return; }
    await loadFiles(files, t('AI answer'));
    setSource('');
  };

  const openZip = async (file?: File) => {
    if (!file) return;
    setBusy('read'); setLoadNote([]);
    try { await loadFiles(await readZip(file), 'ZIP'); }
    catch (error) { notify(error instanceof Error ? error.message : t('That ZIP could not be opened.'), true); }
    finally { setBusy(''); }
  };

  const aiPrompt = useMemo(() => buildProjectPrompt({ idea, kind: promptKind, title: meta.title, subject: meta.subject || meta.genre, language: meta.language }), [idea, promptKind, meta.title, meta.subject, meta.genre, meta.language]);
  const copyPrompt = async () => { try { await navigator.clipboard.writeText(aiPrompt); notify(t('Prompt copied. Paste it into ChatGPT, Claude, Gemini or any AI chat.')); } catch { notify(t('Clipboard is unavailable. Select the prompt and copy it manually.'), true); } };

  const readHtml = async (file: File) => {
    if (!/\.html?$/i.test(file.name)) { notify(t('Choose an .html file for the project code.'), true); return; }
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
      try { path = normalizePackagePath(path); } catch { notify(t('Skipped {0}: unsafe file name.', file.name), true); continue; }
      if (/^index\.html?$/i.test(path) || path === 'localdeck.json') { notify(t('{0} is created automatically and was skipped.', path)); continue; }
      const index = next.findIndex(e => e.path.toLowerCase() === path.toLowerCase());
      const entry = { path, file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined };
      if (index >= 0) next[index] = entry; else next.push(entry);
    }
    setExtras(next);
  };

  const chooseCover = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify(t('Choose a PNG, JPG, WebP or SVG image for the cover.'), true); return; }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    setCover({ blob: file, url: URL.createObjectURL(file), name: `cover.${ext}`, generated: false });
  };

  const generateCover = async () => {
    setBusy('cover');
    try { const blob = await renderCover(meta.title || t('Untitled project'), meta.type, meta.subject || meta.genre); setCover({ blob, url: URL.createObjectURL(blob), name: 'cover.png', generated: true }); }
    catch (error) { notify(error instanceof Error ? error.message : t('Cover could not be generated.'), true); }
    finally { setBusy(''); }
  };

  const manifest: ProjectManifest = useMemo(() => ({
    schemaVersion: 1, title: meta.title.trim() || t('Untitled project'), type: meta.type, format: 'html', entry: 'index.html',
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
      notify(t('{0}.zip is ready · {1}', manifest.title, bytes(zip.size)));
    } catch (error) { notify(error instanceof Error ? error.message : t('The ZIP could not be created.'), true); }
    finally { setBusy(''); }
  };

  const addToLibrary = async () => {
    setBusy('library'); setProgress(0);
    try {
      const zip = await buildZip();
      const [preview] = await analyzeFiles([new File([zip], `${slug(manifest.title)}.zip`, { type: 'application/zip' })]);
      if (!preview) throw new Error(t('The package could not be read back.'));
      const item = await createItem(preview);
      await onAdded();
      notify(t('“{0}” was added to your library.', item.title));
      go('item', `/${encodeURIComponent(item.id)}`);
    } catch (error) { notify(error instanceof Error ? error.message : t('The project could not be added.'), true); }
    finally { setBusy(''); }
  };

  const set = <K extends keyof typeof meta>(key: K, value: (typeof meta)[K]) => setMeta(m => ({ ...m, [key]: value }));
  const TypeIcon = TYPE_ICON[meta.type];
  const step = (n: number, done: boolean) => <span className={`step-dot ${done ? 'done' : ''}`}>{done ? <Check size={13}/> : n}</span>;

  return <section className="panel package-builder" aria-labelledby="pb-title">
    <div className="panel-heading"><span className="panel-icon violet"><PackageCheck size={18}/></span><div><h2 id="pb-title">{t('Package builder')}</h2><p>{t('Bring the HTML your AI made, add images and files, and get a finished LocalDeck ZIP with cover, manifest and every asset.')}</p></div></div>
    <div className="pb-start" role="group" aria-label={t('Start from')}>
      <button type="button" className={`pb-start-card ${source === 'ask' ? 'active' : ''}`} onClick={() => setSource(s => s === 'ask' ? '' : 'ask')}><Bot size={20}/><b>{t('Ask an AI')}</b><small>{t('Get a prompt that makes any AI return the whole project')}</small></button>
      <button type="button" className={`pb-start-card ${source === 'paste' ? 'active' : ''}`} onClick={() => setSource(s => s === 'paste' ? '' : 'paste')}><ClipboardPaste size={20}/><b>{t('Paste the AI’s answer')}</b><small>{t('LocalDeck turns it into files, cover and manifest')}</small></button>
      <button type="button" className="pb-start-card" onClick={() => zipInput.current?.click()} disabled={busy === 'read'}>{busy === 'read' ? <LoaderCircle size={20} className="spin"/> : <FileArchive size={20}/>}<b>{t('Open a ZIP from the AI')}</b><small>{t('Check it, fix details and export it again')}</small></button>
      <input ref={zipInput} type="file" accept=".zip,application/zip" className="visually-hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void openZip(f); }}/>
    </div>
    {source === 'ask' && <div className="pb-source">
      <div className="pb-fields">
        <label className="form-field pb-wide"><span>{t('What should the AI build?')}</span><textarea rows={3} value={idea} onChange={e => setIdea(e.target.value)} placeholder={t('e.g. A study sheet about the Pythagorean theorem with an interactive triangle and 5 practice tasks')}/></label>
        <label className="form-field"><span>{t('Kind of project')}</span><select value={promptKind} onChange={e => setPromptKind(e.target.value as PromptKind)}><option value="learning">{t('Study sheet')}</option><option value="quiz">{t('Quiz')}</option><option value="game">{t('Game')}</option><option value="simulation">{t('Simulation')}</option><option value="presentation">{t('Presentation')}</option><option value="app">{t('App')}</option><option value="tool">{t('Tool')}</option><option value="other">{t('Other')}</option></select></label>
        <div className="form-field"><span>{t('Then')}</span><small className="muted-text">{t('Paste the AI’s full answer back here with “Paste the AI’s answer”. Title, subject and language from the Details step are included.')}</small></div>
      </div>
      <div className="output-heading"><b>{t('Prompt for your AI')}</b><button type="button" className="text-button" onClick={() => void copyPrompt()}><Copy size={15}/> {t('Copy prompt')}</button></div>
      <pre className="prompt-output pb-prompt">{aiPrompt}</pre>
    </div>}
    {source === 'paste' && <div className="pb-source">
      <label className="form-field"><span>{t('The AI’s complete answer')}</span><textarea className="pb-paste" value={answer} onChange={e => setAnswer(e.target.value)} placeholder={t('=== LOCALDECK FILE: index.html ===\n<!doctype html>…\n=== END FILE ===')} spellCheck={false}/></label>
      <div className="pb-cover-row"><button type="button" className="button primary" disabled={!answer.trim()} onClick={() => void importAnswer()}><Sparkles size={15}/> {t('Build files from answer')}</button><span className="muted-text">{t('Works with the LocalDeck format, and with answers that list files as code blocks.')}</span></div>
    </div>}
    {loadNote.length > 0 && <ul className="finding-list pb-notes">{loadNote.map(n => <li key={n}>{tm(n)}</li>)}</ul>}
    <div className="pb-grid">
      <div className="pb-steps">
        <div className="pb-step">
          <h3>{step(1, Boolean(html))} {t('Project code')}</h3>
          {!pasteMode ? <button type="button" className={`pb-drop ${html ? 'filled' : ''}`} onClick={() => htmlInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void readHtml(f); }}>
            {html ? <><FileCode2 size={20}/><b>{htmlName || t('Pasted code')}</b><small>{t('{0} · becomes index.html · click to replace', bytes(new Blob([html]).size))}</small></> : <><Upload size={20}/><b>{t('Drop the HTML file here')}</b><small>{t('or click to choose it')}</small></>}
          </button> : <textarea className="pb-paste" aria-label={t('HTML code of the project')} value={html} onChange={e => { setHtml(e.target.value); setHtmlName(t('Pasted code')); }} onBlur={() => { if (!html.trim()) return; const doc = new DOMParser().parseFromString(html, 'text/html'); setMeta(m => ({ ...m, title: m.title || doc.title.trim(), description: m.description || doc.querySelector('meta[name="description"]')?.getAttribute('content') || '', language: m.language || doc.documentElement.lang || '' })); }} placeholder="<!doctype html>…" spellCheck={false}/>}
          <input ref={htmlInput} type="file" accept=".html,.htm,text/html" className="visually-hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readHtml(f); }}/>
          <button type="button" className="text-button" onClick={() => setPasteMode(v => !v)}>{pasteMode ? t('Choose a file instead') : t('Paste code instead')}</button>
        </div>

        <div className="pb-step">
          <h3>{step(2, Boolean(cover))} {t('Cover image')}</h3>
          <div className="pb-cover-row">
            <button type="button" className="button" onClick={() => coverInput.current?.click()}><ImageIcon size={15}/> {t('Choose image')}</button>
            <button type="button" className="button subtle" onClick={() => void generateCover()} disabled={busy === 'cover'}>{busy === 'cover' ? <LoaderCircle size={15} className="spin"/> : <Wand2 size={15}/>} {t('Generate cover')}</button>
            {cover && <button type="button" className="icon-button" aria-label={t('Remove cover')} onClick={() => setCover(null)}><X size={16}/></button>}
          </div>
          <input ref={coverInput} type="file" accept="image/*" className="visually-hidden" onChange={e => { chooseCover(e.target.files?.[0]); e.target.value = ''; }}/>
          <small className="muted-text">{cover ? `${cover.name} · ${bytes(cover.blob.size)}${cover.generated ? t(' · generated from your title') : ''}` : t('Use the image your AI made, or generate one from the title.')}</small>
        </div>

        <div className="pb-step">
          <h3>{step(3, extras.length > 0)} {t('Extra files')} <span className="muted-text">{t('optional')}</span></h3>
          <div className="pb-cover-row">
            <button type="button" className="button" onClick={() => extraInput.current?.click()}><Paperclip size={15}/> {t('Add files')}</button>
            <span className="muted-text">{t('Images, sounds, scripts, styles or data. Keep the names your HTML uses.')}</span>
          </div>
          <input ref={extraInput} type="file" multiple className="visually-hidden" onChange={e => { addExtras(e.target.files); e.target.value = ''; }}/>
          {extras.length > 0 && <div className="file-list pb-files">{extras.map(e => <div key={e.path} className="file-row">{e.url ? <img src={e.url} alt="" className="pb-thumb"/> : <FileText size={15}/>}<span>{e.path}</span><small>{bytes(e.file.size)}</small><button type="button" className="icon-button" aria-label={t('Remove {0}', e.path)} onClick={() => setExtras(list => list.filter(x => x.path !== e.path))}><Trash2 size={14}/></button></div>)}</div>}
        </div>

        <div className="pb-step">
          <h3>{step(4, Boolean(meta.title.trim()))} {t('Details')}</h3>
          <div className="pb-fields">
            <label className="form-field pb-wide"><span>{t('Title')}</span><input value={meta.title} onChange={e => set('title', e.target.value)} maxLength={120} placeholder={t('e.g. Understanding derivatives')}/></label>
            <label className="form-field"><span>{t('Type')}</span><select value={meta.type} onChange={e => set('type', e.target.value as ContentType)}>{CONTENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></label>
            <label className="form-field"><span>{meta.type === 'game' || meta.type === 'app' || meta.type === 'tool' ? t('Genre or category') : t('Subject')}</span>{meta.type === 'game' || meta.type === 'app' || meta.type === 'tool' ? <input value={meta.genre} onChange={e => set('genre', e.target.value)} placeholder={t('e.g. Arcade')}/> : <input value={meta.subject} onChange={e => set('subject', e.target.value)} placeholder={t('e.g. Mathematics')}/>}</label>
            <label className="form-field"><span>{t('Topic')}</span><input value={meta.topic} onChange={e => set('topic', e.target.value)} placeholder={t('optional')}/></label>
            <label className="form-field"><span>{t('Language')}</span><input value={meta.language} onChange={e => set('language', e.target.value)} placeholder="e.g. de"/></label>
            <label className="form-field pb-wide"><span>{t('Description')}</span><textarea rows={2} value={meta.description} onChange={e => set('description', e.target.value)} placeholder={t('One or two sentences about what it does')}/></label>
            <label className="form-field"><span>{t('Tags, comma separated')}</span><input value={meta.tags} onChange={e => set('tags', e.target.value)}/></label>
            <label className="form-field"><span>{t('Orientation')}</span><select value={meta.orientation} onChange={e => set('orientation', e.target.value as typeof meta.orientation)}><option value="any">{t('Any')}</option><option value="landscape">{t('Landscape')}</option><option value="portrait">{t('Portrait')}</option></select></label>
          </div>
        </div>
      </div>

      <aside className="pb-preview">
        <div className="pb-card beam">
          <div className="pb-card-cover" style={{ backgroundImage: cover ? `url("${cover.url}")` : generatedCoverImage({ title: meta.title || t('Untitled project'), type: meta.type, subject: meta.subject || meta.genre } as LibraryItem) }}>
            <span className="cover-type"><TypeIcon size={17}/></span>
            {!cover && <span className="pb-card-title">{meta.title || t('Untitled project')}</span>}
          </div>
          <div className="pb-card-info"><b>{meta.title || t('Untitled project')}</b><small>{[TYPE_LABEL[meta.type], meta.subject || meta.genre].filter(Boolean).join(' · ')}</small></div>
        </div>
        <div className="pb-check">
          <h3>{t('Package check')}</h3>
          {!html ? <p className="muted-text">{t('Add the HTML to see what’s inside and what’s missing.')}</p> : <>
            <div className={`status-pill ${report?.score}`}><Sparkles size={14}/>{report?.score === 'likely' ? t('Ready to work offline') : t('Needs a look')}</div>
            <ul className="finding-list">{report?.findings.map(f => <li key={f}>{tm(f)}</li>)}</ul>
            <div className="pb-tree">{paths.map(p => <code key={p}>{p}</code>)}</div>
            <small className="muted-text">{t('{0} files · about {1}', paths.length, bytes(totalSize))}</small>
          </>}
        </div>
        {busy && busy !== 'cover' && <div className="progress-bar determinate"><i style={{ width: `${Math.round(progress * 100)}%` }}/></div>}
        <button className="button primary pb-action" disabled={!ready || Boolean(busy)} onClick={() => void download()}>{busy === 'zip' ? <LoaderCircle size={16} className="spin"/> : <ArrowDownToLine size={16}/>} {t('Download ZIP')}</button>
        <button className="button pb-action" disabled={!ready || Boolean(busy)} onClick={() => void addToLibrary()}>{busy === 'library' ? <LoaderCircle size={16} className="spin"/> : <Plus size={16}/>} {t('Add to my library')}</button>
        {!ready && <small className="muted-text">{t('Add the HTML and a title to export.')}</small>}
      </aside>
    </div>
  </section>;
}
