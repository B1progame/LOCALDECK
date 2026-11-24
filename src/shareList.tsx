/* The owner's active links: show, copy, pass on, open or delete each one. */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, Info, Share2, Trash2 } from 'lucide-react';
import { plural, t } from './i18n';
import { savedShares, shareUrl, type SavedShare } from './services/savedShares';
import { EmptyState, bytes, friendlyDate } from './shared';

export type ShareRecord = { id: string; status: string; createdAt: string; expiresAt: string; sizeBytes: number; label: string };

/** A link with a copy button. Also used right after a link was created. */
export function ShareLinkField({ url }: { url: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => { if (state !== 'copied') return; const timer = window.setTimeout(() => setState('idle'), 2200); return () => window.clearTimeout(timer); }, [state]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setState('copied'); }
    catch { input.current?.focus(); input.current?.select(); setState('failed'); }
  };
  return <>
    <div className="share-link-field">
      <input ref={input} readOnly value={url} aria-label={t('Encrypted share link')} onFocus={event => event.currentTarget.select()}/>
      <button type="button" className="button primary" onClick={() => void copy()}>{state === 'copied' ? <Check size={15}/> : <Copy size={15}/>} {state === 'copied' ? t('Copied') : t('Copy')}</button>
    </div>
    <p className="share-link-status" role="status">{state === 'failed' ? t('Copying was blocked. The link is selected, so copy it yourself.') : ''}</p>
  </>;
}

function remaining(expiresAt: string): string {
  const hours = Math.floor((Date.parse(expiresAt) - Date.now()) / 3_600_000);
  if (hours < 0) return t('Expired');
  if (hours < 1) return t('Less than an hour left');
  if (hours < 24) return plural(hours, '{0} hour left', '{0} hours left', hours);
  const days = Math.floor(hours / 24);
  return plural(days, '{0} day left', '{0} days left', days);
}

function ShareRow({ share, saved, onDelete }: { share: ShareRecord; saved: SavedShare | undefined; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const url = saved?.key ? shareUrl(share.id, saved.key) : '';
  const title = saved?.title || t(share.label);
  const pass = () => { navigator.share({ title, url }).catch(() => undefined); };
  return <div className={`share-item ${open ? 'open' : ''}`}>
    <div className="share-row">
      <span className="share-state active"/>
      <span className="share-row-main"><b>{title}</b><small>{remaining(share.expiresAt)} · {bytes(share.sizeBytes)} · {friendlyDate(Date.parse(share.createdAt))}</small></span>
      <div className="share-row-actions">
        <button type="button" className="button" aria-expanded={open} aria-controls={`share-${share.id}`} onClick={() => setOpen(value => !value)}>{open ? t('Hide link') : t('Show link')} <ChevronDown size={15} className="share-chevron"/></button>
        <button type="button" className="button danger-button" aria-label={t('Delete link: {0}', title)} onClick={onDelete}><Trash2 size={14}/> {t('Delete')}</button>
      </div>
    </div>
    {open && <div className="share-detail" id={`share-${share.id}`}>
      {url ? <>
        <ShareLinkField url={url}/>
        <div className="share-detail-actions">
          <a className="button" href={url}><ExternalLink size={15}/> {t('Open link')}</a>
          {typeof navigator.share === 'function' && <button type="button" className="button" onClick={pass}><Share2 size={15}/> {t('Send link')}</button>}
        </div>
        <p className="share-detail-note">{t('Anyone with this link can open the project. It is kept only in this browser, not on the server.')}</p>
      </> : <p className="share-detail-note"><Info size={15}/><span>{t('This link was created on another device, or before LocalDeck kept links. The server does not know its secret part, so it cannot be shown here. Open it on that device, or delete it and create a new one.')}</span></p>}
    </div>}
  </div>;
}

export function ShareList({ shares, onDelete }: { shares: ShareRecord[]; onDelete: (id: string) => void }) {
  const [saved, setSaved] = useState<Record<string, SavedShare>>({});
  useEffect(() => { let active = true; savedShares().then(rows => { if (active) setSaved(rows); }).catch(() => undefined); return () => { active = false; }; }, [shares]);
  if (!shares.length) return <EmptyState icon={Share2} title={t('No active links')} detail={t('Create an encrypted link from a project’s actions menu.')}/>;
  return <div className="share-list">{shares.map(share => <ShareRow key={share.id} share={share} saved={saved[share.id]} onDelete={() => onDelete(share.id)}/>)}</div>;
}
