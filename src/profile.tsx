/* Local profile: a display name and picture kept only in this browser. Separate from any sharing sign-in. */
import { t } from './i18n';
import { useRef, useState } from 'react';
import { ImagePlus, Trash2, UserRound } from 'lucide-react';
import { create } from 'zustand';

export type Profile = { name: string; avatar: string | null };
const KEY = 'localdeck-profile';

function read(): Profile {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<Profile> | null;
    return { name: typeof value?.name === 'string' ? value.name.slice(0, 40) : '', avatar: typeof value?.avatar === 'string' && value.avatar.startsWith('data:image/') ? value.avatar : null };
  } catch { return { name: '', avatar: null }; }
}

export const useProfile = create<Profile & { update: (next: Partial<Profile>) => void }>(set => ({
  ...read(),
  update: next => set(state => {
    const merged = { name: next.name ?? state.name, avatar: next.avatar === undefined ? state.avatar : next.avatar };
    try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* storage full or blocked */ }
    return merged;
  }),
}));

/** Crops the picture to a centered square and stores a small 192px copy. */
async function toAvatar(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 192, 192);
  return canvas.toDataURL('image/jpeg', .86);
}

/** The account used for sharing (Google, email, …). Only its name and picture are ever read here. */
export type AccountInfo = { email: string; name: string; picture: string };

/** Copies the sign-in account's name and/or picture into the local profile. The picture is downloaded once
    and stored as a small local copy, so it keeps working offline and is never linked to the account again. */
export async function importAccountProfile(account: AccountInfo, choice: { name: boolean; picture: boolean }): Promise<{ pictureSaved: boolean }> {
  const { update } = useProfile.getState();
  const displayName = account.name && account.name !== account.email ? account.name.split(/\s+/)[0]!.slice(0, 40) : '';
  if (choice.name && displayName) update({ name: displayName });
  if (!choice.picture || !/^https:\/\//i.test(account.picture)) return { pictureSaved: false };
  try {
    // Google profile photos accept a size suffix; ask for a sharper copy than the default 96px.
    const url = account.picture.replace(/=s\d+-c$/, '=s256-c');
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('download failed');
    update({ avatar: await toAvatar(await response.blob()) });
    return { pictureSaved: true };
  } catch {
    return { pictureSaved: false };
  }
}

const dismissKey = (email: string) => `localdeck-profile-offer:${email.toLowerCase()}`;

/** Shown once after signing in: lets the user choose whether to use the account's name and picture locally. */
export function AccountProfileOffer({ account, notify }: { account: AccountInfo; notify: (message: string, error?: boolean) => void }) {
  const profile = useProfile();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(dismissKey(account.email)) === '1'; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  if (hidden) return null;
  const close = () => { try { localStorage.setItem(dismissKey(account.email), '1'); } catch { /* ignore */ } setHidden(true); };
  const run = async (choice: { name: boolean; picture: boolean }) => {
    setBusy(true);
    const { pictureSaved } = await importAccountProfile(account, choice);
    setBusy(false); close();
    notify(choice.picture && !pictureSaved ? t('Your name was saved. The picture could not be copied; you can add one in Settings → Profile.') : t('Saved to your profile on this device.'));
  };
  return <section className="account-offer" aria-label={t('Use your account for your profile')}>
    <span className="account-offer-photo">{/^https:\/\//i.test(account.picture) ? <img src={account.picture} alt="" referrerPolicy="no-referrer"/> : <UserRound size={22}/>}</span>
    <div className="account-offer-copy">
      <b>{t('Use “{0}” for your LocalDeck profile?', account.name || account.email)}</b>
      <small>{t('Your name and picture are copied to this device only. Your library stays local, and you can change or remove them any time in Settings.')}</small>
    </div>
    <div className="account-offer-actions">
      <button type="button" className="button primary" disabled={busy} onClick={() => void run({ name: true, picture: true })}>{t('Use name & picture')}</button>
      <button type="button" className="button" disabled={busy} onClick={() => void run({ name: true, picture: false })}>{t('Name only')}</button>
      <button type="button" className="text-button" disabled={busy} onClick={close}>{t('No thanks')}</button>
    </div>
    {profile.avatar && <span className="visually-hidden">{t('You already have a profile picture; choosing a picture replaces it.')}</span>}
  </section>;
}

export function Avatar({ size = 30, className = '' }: { size?: number; className?: string }) {
  const { name, avatar } = useProfile();
  return <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: size * .42 }} aria-hidden="true">
    {avatar ? <img src={avatar} alt=""/> : name.trim() ? name.trim()[0]!.toUpperCase() : <UserRound size={size * .55}/>}
  </span>;
}

export function ProfileSettings({ notify, account }: { notify: (message: string, error?: boolean) => void; account?: AccountInfo | null }) {
  const { name, avatar, update } = useProfile();
  const [draft, setDraft] = useState(name);
  const [importing, setImporting] = useState(false);
  const fromAccount = async () => {
    if (!account) return;
    setImporting(true);
    const { pictureSaved } = await importAccountProfile(account, { name: true, picture: true });
    setImporting(false);
    setDraft(useProfile.getState().name);
    notify(pictureSaved ? t('Copied your account’s name and picture to this device.') : t('Copied your name. The picture could not be downloaded.'), !pictureSaved && Boolean(account.picture));
  };
  const input = useRef<HTMLInputElement>(null);
  const choose = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify(t('Choose a PNG, JPG or WebP picture.'), true); return; }
    try { update({ avatar: await toAvatar(file) }); notify(t('Profile picture updated.')); }
    catch { notify(t('That picture could not be read.'), true); }
  };
  return <div className="profile-editor">
    <button type="button" className="profile-photo" onClick={() => input.current?.click()} aria-label={t('Choose a profile picture')}>
      <Avatar size={76}/><span className="profile-photo-edit"><ImagePlus size={16}/></span>
    </button>
    <input ref={input} type="file" accept="image/*" className="visually-hidden" onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }}/>
    <div className="profile-fields">
      <label className="form-field"><span>{t('Your name')}</span><input value={draft} maxLength={40} placeholder={t('e.g. Alex')} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft.trim() !== name) { update({ name: draft.trim() }); notify(draft.trim() ? t('Hi {0}! Your name is saved on this device.', draft.trim()) : t('Name removed.')); } }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}/></label>
      <div className="row-actions">
        <button type="button" className="button" onClick={() => input.current?.click()}><ImagePlus size={15}/> {avatar ? t('Change picture') : t('Add picture')}</button>
        {account && <button type="button" className="button subtle" disabled={importing} onClick={() => void fromAccount()}><UserRound size={15}/> {t('Use my sign-in name & picture')}</button>}
        {avatar && <button type="button" className="button danger-button" onClick={() => { update({ avatar: null }); notify(t('Profile picture removed.')); }}><Trash2 size={15}/> {t('Remove')}</button>}
      </div>
      <small className="muted-text">{t('Only stored in this browser and never uploaded. Copying from your sign-in account makes a local copy; it doesn’t link the two.')}</small>
    </div>
  </div>;
}
