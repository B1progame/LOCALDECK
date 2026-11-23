/* Local profile: a display name and picture kept only in this browser. Separate from any sharing sign-in. */
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
async function toAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 192, 192);
  return canvas.toDataURL('image/jpeg', .86);
}

export function Avatar({ size = 30, className = '' }: { size?: number; className?: string }) {
  const { name, avatar } = useProfile();
  return <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: size * .42 }} aria-hidden="true">
    {avatar ? <img src={avatar} alt=""/> : name.trim() ? name.trim()[0]!.toUpperCase() : <UserRound size={size * .55}/>}
  </span>;
}

export function ProfileSettings({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const { name, avatar, update } = useProfile();
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const choose = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify('Choose a PNG, JPG or WebP picture.', true); return; }
    try { update({ avatar: await toAvatar(file) }); notify('Profile picture updated.'); }
    catch { notify('That picture could not be read.', true); }
  };
  return <div className="profile-editor">
    <button type="button" className="profile-photo" onClick={() => input.current?.click()} aria-label="Choose a profile picture">
      <Avatar size={76}/><span className="profile-photo-edit"><ImagePlus size={16}/></span>
    </button>
    <input ref={input} type="file" accept="image/*" className="visually-hidden" onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }}/>
    <div className="profile-fields">
      <label className="form-field"><span>Your name</span><input value={draft} maxLength={40} placeholder="e.g. Alex" onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft.trim() !== name) { update({ name: draft.trim() }); notify(draft.trim() ? `Hi ${draft.trim()}! Your name is saved on this device.` : 'Name removed.'); } }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}/></label>
      <div className="row-actions">
        <button type="button" className="button" onClick={() => input.current?.click()}><ImagePlus size={15}/> {avatar ? 'Change picture' : 'Add picture'}</button>
        {avatar && <button type="button" className="button danger-button" onClick={() => { update({ avatar: null }); notify('Profile picture removed.'); }}><Trash2 size={15}/> Remove</button>}
      </div>
      <small className="muted-text">Only stored in this browser. It is not your sharing sign-in and is never uploaded.</small>
    </div>
  </div>;
}
