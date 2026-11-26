/* In the details of a project: what it may do in the player. The internet is off unless the person allows it, and
   what the project saved (high scores, settings) can be seen and deleted. */
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ITEMS_CHANGED } from './autoScan';
import { t } from './i18n';
import { updateItem } from './services/library';
import { deleteProjectSave, readProjectSave, saveSize, type ProjectSave } from './services/projectSaves';
import { bytes } from './shared';
import type { LibraryItem } from './types';

export function ProjectRuntime({ item }: { item: LibraryItem }) {
  const [save, setSave] = useState<ProjectSave | null>(null);
  const [busy, setBusy] = useState(false);
  const internet = item.runtimeSettings.internet === true;
  useEffect(() => { let active = true; void readProjectSave(item.id).then(value => { if (active) setSave(value); }); return () => { active = false; }; }, [item.id, item.lastOpenedAt]);

  const allow = async (on: boolean) => {
    if (on && !window.confirm(t('Allow “{0}” to use the internet? It can then load files from other websites and send them what it knows, for example what you type into it. It still cannot see your library or other projects.', item.title))) return;
    setBusy(true);
    try { await updateItem(item.id, { runtimeSettings: { ...item.runtimeSettings, internet: on } }, { touch: false }); window.dispatchEvent(new CustomEvent(ITEMS_CHANGED, { detail: '' })); }
    finally { setBusy(false); }
  };
  const forget = async () => {
    if (!window.confirm(t('Delete what “{0}” saved, such as scores and settings? It starts fresh next time.', item.title))) return;
    await deleteProjectSave(item.id);
    setSave(null);
  };
  const entries = save ? Object.keys(save.local).length + (save.cookies ? 1 : 0) : 0;

  return <div className="runtime-rows">
    <label className="setting-row"><span><b>{t('Allow the internet')}</b><small>{internet ? t('On. The project may load files and send data to other websites.') : t('Off. Nothing can leave this project. Turn it on for projects that need online fonts, libraries or data.')}</small></span><input type="checkbox" checked={internet} disabled={busy} onChange={event => void allow(event.target.checked)}/></label>
    <div className="setting-row"><span><b>{t('Saved by the project')}</b><small>{entries ? t('{0} entries, {1}. Scores and settings stay on this device and are not in backups.', entries, bytes(saveSize(save!))) : t('Nothing yet. What the project saves with localStorage or cookies stays on this device.')}</small></span>{entries > 0 && <button type="button" className="button subtle" onClick={() => void forget()}><Trash2 size={15}/> {t('Delete')}</button>}</div>
  </div>;
}
