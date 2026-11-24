/* Service overview for the admin account. The Worker checks admin rights on every request;
   hiding this panel is only a convenience. Project contents stay encrypted, also for the admin. */
import { t } from './i18n';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { bytes, friendlyDate } from './shared';

type AdminShare = { id: string; owner: string; mine: boolean; createdAt: string; expiresAt: string; sizeBytes: number };
type Overview = { totals: { links: number; owners: number; bytes: number; limitBytes: number; uploadsToday: number; uploadsLimit: number }; shares: AdminShare[] };

export function AdminPanel({ api, token, notify, onDeleted }: { api: string; token: string; notify: (message: string, error?: boolean) => void; onDeleted: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${api}/api/v1/shares/admin/overview`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(response.status === 403 || response.status === 401 ? t('This account is not an admin, or the sign-in expired.') : response.status === 429 ? t('Too many requests. Wait a little, then refresh.') : t('The overview could not be loaded.'));
      setData(await response.json() as Overview);
    } catch (reason) { setError(reason instanceof TypeError ? t('The sharing service did not answer.') : (reason as Error).message); }
    finally { setBusy(false); }
  }, [api, token]);
  useEffect(() => { void load(); }, [load]);

  const remove = async (share: AdminShare) => {
    if (!window.confirm(share.mine ? t('Delete your link now? It stops working immediately.') : t('Delete another person’s link? It stops working immediately and cannot be restored.'))) return;
    try {
      const response = await fetch(`${api}/api/v1/shares/${share.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(t('This link could not be deleted.'));
      notify(t('Share link deleted.'));
      if (share.mine) onDeleted();
      await load();
    } catch (reason) { notify(reason instanceof TypeError ? t('The sharing service did not answer.') : (reason as Error).message, true); }
  };

  const totals = data?.totals;
  return <section className="share-manager panel admin-panel" aria-labelledby="admin-title">
    <div className="share-manager-heading">
      <span className="share-manager-icon"><ShieldCheck size={19}/></span>
      <div><h2 id="admin-title">{t('Admin overview')}</h2><p>{t('Every active link on this service. Project contents stay encrypted, also for you.')}</p></div>
      <div className="share-session-actions"><button className="button" disabled={busy} onClick={() => void load()}>{busy ? <LoaderCircle size={15} className="spin"/> : <RefreshCw size={15}/>} {t('Refresh')}</button></div>
    </div>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    {totals && <dl className="admin-stats">
      <div><dt>{t('Active links')}</dt><dd>{totals.links}</dd></div>
      <div><dt>{t('Accounts with links')}</dt><dd>{totals.owners}</dd></div>
      <div><dt>{t('Storage')}</dt><dd>{bytes(totals.bytes)} <small>{t('of {0}', bytes(totals.limitBytes))}</small></dd></div>
      <div><dt>{t('Uploads today')}</dt><dd>{totals.uploadsToday} <small>{t('of {0}', totals.uploadsLimit)}</small></dd></div>
    </dl>}
    {data && (data.shares.length ? <div className="share-list">{data.shares.map(share => <div className="share-row" key={share.id}>
      <span className="share-state active"/>
      <span className="share-row-main"><b>{share.mine ? t('Your link') : t('Account {0}', share.owner)}</b><small>{t('Expires {0} · {1} · link {2}', friendlyDate(Date.parse(share.expiresAt)), bytes(share.sizeBytes), share.id.slice(0, 8))}</small></span>
      <button className="button danger-button" onClick={() => void remove(share)}><Trash2 size={14}/> {t('Delete link')}</button>
    </div>)}</div> : <p className="share-setup-hint">{t('There are no active links right now.')}</p>)}
  </section>;
}
