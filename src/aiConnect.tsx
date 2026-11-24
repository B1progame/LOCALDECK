/* Settings: connect an AI over MCP, so it can create and update projects and hand over links. */
import React, { useCallback, useEffect, useState } from 'react';
import { Bot, LoaderCircle, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { plural, t } from './i18n';
import type { Limits } from './services/shareService';
import { ShareLinkField } from './shareList';
import { friendlyDate } from './shared';

type Connection = { id: string; name: string; createdAt: number; lastUsed: number | null; calls: number; projects: number };
type Data = { enabled: boolean; limits: Limits & { aiPerDay?: number; aiDays?: number }; connections: Connection[] };

export function AiConnect({ api, token, notify }: { api: string; token: string | null; notify: (message: string, error?: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState('');

  const call = useCallback(async (path = '', method = 'GET', body?: unknown): Promise<Response> => {
    let response: Response;
    try { response = await fetch(`${api}/api/v1/shares/ai${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new Error(t('The sharing service did not answer.')); }
    if (response.ok) return response;
    const { error: code } = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(response.status === 401 ? t('Your sign-in expired. Please sign in again.')
      : code === 'too_many_connections' ? t('You already have five connections. Remove one first.')
      : code === 'ai_disabled' ? t('AI connections are switched off by the operator.')
      : code === 'blocked' ? t('This account is blocked. Contact the operator of this service.')
      : response.status === 404 ? t('AI connections are not available on this server yet.')
      : response.status === 429 ? t('Too many requests. Wait a little, then refresh.') : t('That did not work. Please try again.'));
  }, [api, token]);

  const load = useCallback(async () => {
    if (!token || !api) return;
    try { setData(await (await call()).json() as Data); setError(''); }
    catch (reason) { setError((reason as Error).message); }
  }, [call, token, api]);
  useEffect(() => { void load(); }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { const { url } = await (await call('', 'POST', { name: name.trim() || t('My AI') })).json() as { url: string }; setFresh(url); setName(''); await load(); }
    catch (reason) { notify((reason as Error).message, true); }
    finally { setBusy(false); }
  };
  const remove = async (connection: Connection) => {
    if (!window.confirm(t('Remove “{0}”? This AI loses access at once. Links it created keep working until they expire, but it can no longer change them.', connection.name))) return;
    try { await call(`/${connection.id}`, 'DELETE'); setFresh(''); notify(t('Connection removed.')); await load(); }
    catch (reason) { notify((reason as Error).message, true); }
  };

  if (!token) return <div className="ai-connect"><p className="ai-intro">{t('An AI that supports MCP, such as Claude, can build projects for you here, give you a link and change them later.')}</p><a className="button primary" href="#/login"><ShieldCheck size={15}/> {t('Sign in to connect an AI')}</a></div>;
  return <div className="ai-connect">
    <p className="ai-intro">{t('An AI that supports MCP, such as Claude, can build projects for you here, give you a link and change them later.')}</p>
    <ol className="ai-steps">
      <li>{t('Create a connection below and copy its address.')}</li>
      <li>{t('Claude: Settings → Connectors → Add custom connector, then paste the address. Other apps call it “MCP server”.')}</li>
      <li>{t('The AI reads the LocalDeck guide by itself: how the website works, what AI studio asks for and how to hand over a project.')}</li>
      <li>{t('Ask, for example: “Make a quiz about photosynthesis in LocalDeck and give me the link.”')}</li>
    </ol>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    {fresh && <div className="ai-fresh" role="status">
      <b>{t('Your private address')}</b>
      <p>{t('Copy it now. It works like a password and is shown only once. Give it only to your own AI.')}</p>
      <ShareLinkField url={fresh} label={t('Your private address')}/>
      <details><summary>{t('For Claude Code')}</summary><code className="ai-command">{`claude mcp add --transport http localdeck ${fresh}`}</code></details>
    </div>}
    {data && (data.enabled ? <form className="ai-new" onSubmit={event => void create(event)}>
      <label className="form-field"><span>{t('Name of the connection')}</span><input value={name} onChange={event => setName(event.target.value)} maxLength={40} placeholder={t('e.g. Claude on my laptop')}/></label>
      <button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin"/> : <Plus size={15}/>} {t('Create connection')}</button>
    </form> : <p className="share-detail-note">{t('AI connections are switched off by the operator.')}</p>)}
    {data && data.connections.length > 0 && <ul className="ai-list">{data.connections.map(connection => <li key={connection.id}>
      <span className="ai-mark"><Bot size={18}/></span>
      <span className="ai-name"><b>{connection.name}</b><small>{connection.lastUsed ? t('Last used {0}', friendlyDate(connection.lastUsed)) : t('Not used yet')} · {plural(connection.projects, '{0} project', '{0} projects', connection.projects)}</small></span>
      <button type="button" className="button danger-button" aria-label={t('Remove connection: {0}', connection.name)} onClick={() => void remove(connection)}><Trash2 size={14}/> {t('Remove')}</button>
    </li>)}</ul>}
    <p className="ai-privacy"><ShieldCheck size={16}/><span>{t('Your library stays private: the AI only sees projects it created itself. Those are stored encrypted, but the company behind the AI sees what it writes.')}{data?.limits.aiPerDay !== undefined && ` ${t('Limits: {0} changes per day, 10 MiB per project, links stay online for {1} days after the last change.', data.limits.aiPerDay, data.limits.aiDays)}`}</span></p>
  </div>;
}
