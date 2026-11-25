/* Admin page: statistics, limits, accounts and links of the sharing service.
   The Worker checks admin rights on every request. Hiding this page is only a convenience. */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Ban, ChevronDown, LoaderCircle, RefreshCw, RotateCcw, Save, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { language, plural, t } from './i18n';
import { authFetch, dropAdmin } from './services/session';
import type { Limits as ShareLimits } from './services/shareService';
import { EmptyState, PageHeading, bytes, friendlyDate } from './shared';

type Limits = Required<ShareLimits>;
type Service = { totalMiB: number; perDay: number; open: boolean; ai: boolean };
type Settings = { users: Limits; admins: Limits; service: Service };
type Day = { day: number; uploads: number; bytes: number; downloads: number; signIns: number; accounts: number };
type Account = { id: string; email: string | null; name: string | null; provider: string | null; firstSeen: number | null; lastSeen: number | null; signIns: number; uploads: number; uploadedBytes: number; downloads: number; blocked: boolean; limits: Limits | null; links: number; bytes: number; mine: boolean };
type Share = { id: string; ownerId: string; owner: string | null; createdAt: string; expiresAt: string; sizeBytes: number; downloads: number; lastDownload: number | null; ai: boolean; mine: boolean };
type Overview = {
  totals: { links: number; bytes: number; limitBytes: number; uploadsToday: number; uploadsLimit: number; accounts: number; activeWeek: number; blocked: number };
  ai: { connections: number; projects: number; bytes: number; changes: number };
  visits?: Array<{ day: number; visitors: number; opens: number }>;
  databases?: Array<{ name: string; bytes: number; projects: number; capBytes: number }>; kv?: { bytes: number; capBytes: number };
  settings: Settings; defaults: Settings; bounds: Record<string, [number, number]>; days: Day[]; accounts: Account[]; shares: Share[]; log: Array<{ at: number; admin: string; action: string; target: string }>;
};
type Notify = (message: string, error?: boolean) => void;

const DAY = 86_400_000;
const number = (value: number) => value.toLocaleString(language());
const shortDay = (time: number) => new Intl.DateTimeFormat(language(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(time);
const moment = (time: number) => new Intl.DateTimeFormat(language(), { dateStyle: 'medium', timeStyle: 'short' }).format(time);
const accountName = (account: Pick<Account, 'email' | 'id'>) => account.email || t('Account {0}', account.id.replace(/^firebase:/, '').slice(0, 6));
const PROVIDERS: Record<string, string> = { 'google.com': 'Google', 'github.com': 'GitHub', 'facebook.com': 'Facebook' };
const providerName = (provider: string | null) => provider ? PROVIDERS[provider] ?? t('Email') : t('Unknown');

/* ---------- Charts ---------- */

/** One measure per day for the last 30 days. One series, so the title names it and no legend is needed. */
function DayChart<T extends { day: number }>({ title, days, value, format = number }: { title: string; days: T[]; value: (day: T) => number; format?: (value: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const series = useMemo(() => {
    const today = Math.floor(Date.now() / DAY) * DAY;
    const known = new Map(days.map(day => [day.day, value(day)]));
    return Array.from({ length: 30 }, (_, index) => { const day = today - (29 - index) * DAY; return { day, value: known.get(day) ?? 0 }; });
  }, [days, value]);
  const max = Math.max(1, ...series.map(entry => entry.value));
  const total = series.reduce((sum, entry) => sum + entry.value, 0);
  const shown = active === null ? null : series[active]!;
  const move = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    setActive(current => Math.max(0, Math.min(29, (current ?? (step > 0 ? -1 : 30)) + step)));
  };
  return <figure className="admin-chart panel">
    <figcaption><span>{title}</span><b>{shown ? format(shown.value) : format(total)}</b><small>{shown ? shortDay(shown.day) : t('Last 30 days')}</small></figcaption>
    <div className="admin-bars" tabIndex={0} role="img" aria-label={t('{0}: {1} in the last 30 days. Use the arrow keys for single days.', title, format(total))} onKeyDown={move} onBlur={() => setActive(null)} onPointerLeave={() => setActive(null)}>
      {series.map((entry, index) => <span key={entry.day} className={`admin-bar ${active === index ? 'active' : ''}`} onPointerEnter={() => setActive(index)}><i style={{ height: entry.value ? `${Math.max(4, entry.value / max * 100)}%` : '0' }}/></span>)}
    </div>
    <div className="admin-axis" aria-hidden="true"><span>{shortDay(series[0]!.day)}</span><span>{shortDay(series[29]!.day)}</span></div>
    <span className="visually-hidden" role="status">{shown ? `${shortDay(shown.day)}: ${format(shown.value)}` : ''}</span>
  </figure>;
}

function Meter({ label, value, max, format }: { label: string; value: number; max: number; format: (value: number) => string }) {
  const part = Math.min(1, value / Math.max(1, max));
  return <div className="admin-meter"><div><span>{label}</span><b>{t('{0} of {1}', format(value), format(max))}</b></div><span className="storage-track"><i style={{ width: `${Math.max(part * 100, value ? 1 : 0)}%` }}/></span></div>;
}

/* ---------- Limits ---------- */

const LIMIT_FIELDS: Array<{ key: keyof Limits; label: string; unit: string }> = [
  { key: 'linkMiB', label: t('Size per link'), unit: 'MiB' },
  { key: 'storageMiB', label: t('Storage per account'), unit: 'MiB' },
  { key: 'perHour', label: t('Uploads per hour'), unit: '' },
  { key: 'perDay', label: t('Uploads per day'), unit: '' },
  { key: 'days', label: t('Links stay online'), unit: t('days') },
  { key: 'aiPerDay', label: t('AI changes per day'), unit: '' },
  { key: 'aiDays', label: t('AI projects stay online'), unit: t('days') },
];

function NumberField({ label, unit, value, bounds, onChange }: { label: string; unit: string; value: number; bounds: [number, number]; onChange: (value: number) => void }) {
  const id = useId();
  return <div className="admin-field"><label htmlFor={id}>{label}</label>
    <span className="admin-number"><input id={id} type="number" inputMode="numeric" step={1} min={bounds[0]} max={bounds[1]} required value={Number.isNaN(value) ? '' : value} onChange={event => onChange(event.target.value === '' ? NaN : Number(event.target.value))}/>{unit && <span>{unit}</span>}</span>
    <small>{t('{0} to {1}', number(bounds[0]), number(bounds[1]))}</small></div>;
}

function LimitFields({ value, bounds, onChange }: { value: Limits; bounds: Overview['bounds']; onChange: (value: Limits) => void }) {
  return <div className="admin-fields">{LIMIT_FIELDS.map(field => <NumberField key={field.key} label={field.label} unit={field.unit} value={value[field.key]} bounds={bounds[field.key]!} onChange={next => onChange({ ...value, [field.key]: next })}/>)}</div>;
}

function LimitsEditor({ data, save }: { data: Overview; save: (settings: Settings) => Promise<void> }) {
  const [draft, setDraft] = useState(data.settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(data.settings), [data.settings]);
  const changed = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { await save(draft); } finally { setBusy(false); } };
  const service = (next: Partial<Service>) => setDraft({ ...draft, service: { ...draft.service, ...next } });
  return <form className="panel admin-limits" onSubmit={event => void submit(event)}>
    <label className="setting-row admin-open"><span><b>{t('Allow new links')}</b><small>{t('Turn this off to pause uploads for everyone except admins. Existing links keep working.')}</small></span><input type="checkbox" checked={draft.service.open} onChange={event => service({ open: event.target.checked })}/></label>
    <label className="setting-row admin-open"><span><b>{t('Allow AI connections')}</b><small>{t('Turn this off to stop all AI connections except yours. Existing AI projects keep working.')}</small></span><input type="checkbox" checked={draft.service.ai} onChange={event => service({ ai: event.target.checked })}/></label>
    <fieldset><legend>{t('Everyone')}</legend><p>{t('Applies to every account without its own limits.')}</p><LimitFields value={draft.users} bounds={data.bounds} onChange={users => setDraft({ ...draft, users })}/></fieldset>
    <fieldset><legend>{t('Admins')}</legend><p>{t('Applies to you. Links over 24 MiB are uploaded in parts.')}</p><LimitFields value={draft.admins} bounds={data.bounds} onChange={admins => setDraft({ ...draft, admins })}/></fieldset>
    <fieldset><legend>{t('Whole service')}</legend><p>{t('All accounts together. The free plan of Cloudflare ends at 1 GB and 1,000 writes a day.')}</p><div className="admin-fields">
      <NumberField label={t('Total storage')} unit="MiB" value={draft.service.totalMiB} bounds={data.bounds.totalMiB!} onChange={totalMiB => service({ totalMiB })}/>
      <NumberField label={t('Uploads per day')} unit="" value={draft.service.perDay} bounds={data.bounds.servicePerDay!} onChange={perDay => service({ perDay })}/>
    </div></fieldset>
    <div className="admin-save">
      <button type="button" className="button" onClick={() => setDraft(data.defaults)}><RotateCcw size={15}/> {t('Default values')}</button>
      <button type="submit" className="button primary" disabled={!changed || busy}>{busy ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>} {t('Save limits')}</button>
      <small role="status">{changed ? t('Not saved yet') : ''}</small>
    </div>
  </form>;
}

/* ---------- Accounts ---------- */

type AccountSort = 'seen' | 'bytes' | 'uploads' | 'downloads';

function AccountRow({ account, data, act }: { account: Account; data: Overview; act: Actions }) {
  const [open, setOpen] = useState(false);
  const general = account.mine ? data.settings.admins : data.settings.users;
  const [draft, setDraft] = useState<Limits>(account.limits ?? general);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(account.limits ?? general), [account.limits, general]);
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  const name = accountName(account);
  const facts: Array<[string, string]> = [
    [t('First sign-in'), account.firstSeen ? friendlyDate(account.firstSeen) : t('Unknown')],
    [t('Sign-ins'), number(account.signIns)],
    [t('Uploads so far'), `${number(account.uploads)} · ${bytes(account.uploadedBytes)}`],
    [t('Downloads of their links'), number(account.downloads)],
    [t('Sign-in method'), providerName(account.provider)],
  ];
  return <li className={`admin-account ${open ? 'open' : ''} ${account.blocked ? 'blocked' : ''}`}>
    <button type="button" className="admin-account-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="admin-initial" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <span className="admin-account-name"><b>{name}</b><small>{account.mine ? t('You') : account.name && account.name !== account.email ? account.name : providerName(account.provider)}{account.lastSeen ? ` · ${t('Last seen {0}', friendlyDate(account.lastSeen))}` : ''}</small></span>
      <span className="admin-tags">{account.blocked && <span className="admin-tag bad"><Ban size={12}/> {t('Blocked')}</span>}{account.limits && <span className="admin-tag">{t('Own limits')}</span>}</span>
      <span className="admin-account-numbers"><span>{plural(account.links, '{0} link', '{0} links', number(account.links))}</span><span>{bytes(account.bytes)}</span></span>
      <ChevronDown size={16} className="share-chevron"/>
    </button>
    {open && <div className="admin-account-body">
      <dl className="admin-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {account.email && <form onSubmit={event => { event.preventDefault(); void run(() => act.account(account, { limits: draft }, t('Limits for {0} saved.', name))); }}>
        <h3>{t('Limits of this account')}</h3>
        <LimitFields value={draft} bounds={data.bounds} onChange={setDraft}/>
        <div className="admin-save">
          {account.limits && <button type="button" className="button" disabled={busy} onClick={() => void run(() => act.account(account, { limits: null }, t('{0} uses the general limits again.', name)))}><RotateCcw size={15}/> {t('Use general limits')}</button>}
          <button type="submit" className="button primary" disabled={busy}><Save size={15}/> {t('Save limits')}</button>
        </div>
      </form>}
      {!account.mine && <div className="admin-danger">
        {account.links > 0 && <button type="button" className="button danger-button" disabled={busy} onClick={() => void run(() => act.removeLinks(account))}><Trash2 size={15}/> {t('Delete all links')}</button>}
        {account.email && <button type="button" className={`button ${account.blocked ? '' : 'danger-button'}`} disabled={busy} onClick={() => { if (account.blocked || window.confirm(t('Block {0}? They can no longer sign in to share. Their links keep working until you delete them.', name))) void run(() => act.account(account, { blocked: !account.blocked }, account.blocked ? t('{0} can share again.', name) : t('{0} is blocked.', name))); }}><Ban size={15}/> {account.blocked ? t('Unblock') : t('Block account')}</button>}
      </div>}
    </div>}
  </li>;
}

function FilterBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const id = useId();
  return <div className="field-search admin-search"><Search size={16}/><label className="field-label" htmlFor={id}>{t('Search')}</label><input id={id} value={value} onChange={event => onChange(event.target.value)} placeholder={label}/></div>;
}

function Accounts({ data, act }: { data: Overview; act: Actions }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<AccountSort>('seen');
  const list = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    const value: Record<AccountSort, (account: Account) => number> = { seen: account => account.lastSeen ?? 0, bytes: account => account.bytes, uploads: account => account.uploads, downloads: account => account.downloads };
    return data.accounts.filter(account => !text || `${account.email} ${account.name}`.toLocaleLowerCase().includes(text)).sort((a, b) => value[sort](b) - value[sort](a));
  }, [data.accounts, query, sort]);
  return <>
    <div className="library-toolbar"><FilterBox value={query} onChange={setQuery} label={t('Name or email')}/><span className="select-wrap"><select value={sort} onChange={event => setSort(event.target.value as AccountSort)} aria-label={t('Sort accounts')}><option value="seen">{t('Last seen')}</option><option value="bytes">{t('Storage')}</option><option value="uploads">{t('Uploads')}</option><option value="downloads">{t('Downloads')}</option></select></span></div>
    {list.length ? <ul className="admin-list">{list.map(account => <AccountRow key={account.id} account={account} data={data} act={act}/>)}</ul> : <EmptyState icon={Search} title={t('No accounts found')} detail={data.accounts.length ? t('Try another name or email.') : t('Accounts appear here after their next sign-in.')}/>}
  </>;
}

function Links({ data, act }: { data: Overview; act: Actions }) {
  const [query, setQuery] = useState('');
  const text = query.trim().toLocaleLowerCase();
  const list = data.shares.filter(share => !text || `${share.owner} ${share.id}`.toLocaleLowerCase().includes(text));
  return <>
    <div className="library-toolbar"><FilterBox value={query} onChange={setQuery} label={t('Email or link number')}/></div>
    {list.length ? <div className="share-list">{list.map(share => <div className="share-row" key={share.id}>
      <span className="share-state active"/>
      <span className="share-row-main"><b>{share.mine ? t('Your link') : accountName({ email: share.owner, id: share.ownerId })}{share.ai && <span className="admin-tag">{t('AI')}</span>}</b><small>{bytes(share.sizeBytes)} · {plural(share.downloads, '{0} download', '{0} downloads', number(share.downloads))} · {t('Expires {0}', friendlyDate(Date.parse(share.expiresAt)))} · {share.id.slice(0, 8)}</small></span>
      <div className="share-row-actions"><button type="button" className="button danger-button" onClick={() => void act.removeLink(share)}><Trash2 size={14}/> {t('Delete')}</button></div>
    </div>)}</div> : <EmptyState icon={Search} title={t('No active links')} detail={data.shares.length ? t('Try another search.') : t('There are no active links right now.')}/>}
  </>;
}

const ACTION_TEXT: Record<string, string> = { limits: t('Changed the limits'), block: t('Blocked an account'), unblock: t('Unblocked an account'), account_limits: t('Changed limits of an account'), account_limits_reset: t('Reset limits of an account'), delete_links: t('Deleted all links of an account'), delete_link: t('Deleted a link') };

/* ---------- Page ---------- */

type Actions = { account: (account: Account, change: { blocked?: boolean; limits?: Limits | null }, done: string) => Promise<void>; removeLinks: (account: Account) => Promise<void>; removeLink: (share: Share) => Promise<void> };
const TABS = ['overview', 'accounts', 'links', 'limits', 'log'] as const;
type Tab = typeof TABS[number];

function visitNumbers(days: Array<{ day: number; visitors: number; opens: number }> = []) {
  const today = Math.floor(Date.now() / DAY) * DAY, now = days.find(entry => entry.day === today);
  const best = days.reduce<{ day: number; visitors: number } | null>((found, entry) => !found || entry.visitors > found.visitors ? entry : found, null);
  // Days before the first visit do not pull the average down.
  const first = days.length ? Math.min(...days.map(entry => entry.day)) : today, span = Math.max(1, Math.round((today - first) / DAY) + 1);
  return { today: now?.visitors ?? 0, opensToday: now?.opens ?? 0, average: Math.round(days.reduce((sum, entry) => sum + entry.visitors, 0) / span), best: best?.visitors ?? 0, bestDay: best?.day ?? 0 };
}

export function AdminPage({ api, session, notify }: { api: string; session: { email: string; token: string; admin?: boolean } | null; notify: Notify }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  // The account, not the token: a renewed sign-in must not load everything again.
  const token = session?.admin ? session.email : '';
  const loading = useRef(0);

  const call = useCallback(async (path: string, method = 'GET', body?: unknown): Promise<Response> => {
    let response: Response;
    try { response = await authFetch(`${api}/api/v1/shares${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new Error(t('The sharing service did not answer.')); }
    if (response.ok) return response;
    // The rights are checked by the server on every request. Without them the page goes away.
    if (path === '/admin/overview' && [401, 403, 404].includes(response.status)) dropAdmin();
    throw new Error(response.status === 401 || response.status === 403 ? t('This account is not an admin, or the sign-in expired.') : response.status === 429 ? t('Too many requests. Wait a little, then refresh.') : response.status === 404 ? t('The Worker does not know this yet. Deploy it once with “npx wrangler deploy”.') : t('That did not work. Please try again.'));
  }, [api, token]);

  const load = useCallback(async () => {
    if (!token) return;
    const current = ++loading.current;
    setBusy(true); setError('');
    try {
      const next = await (await call('/admin/overview')).json() as Partial<Overview>;
      if (current !== loading.current) return;
      if (!next.settings || !next.accounts || !next.ai) throw new Error(t('The Worker does not know this yet. Deploy it once with “npx wrangler deploy”.'));
      setData(next as Overview);
    } catch (reason) { if (current === loading.current) setError((reason as Error).message); }
    finally { if (current === loading.current) setBusy(false); }
  }, [call, token]);
  useEffect(() => { void load(); }, [load]);

  const attempt = async (action: () => Promise<void>) => { try { await action(); } catch (reason) { notify((reason as Error).message, true); } };
  const act: Actions = {
    account: (account, change, done) => attempt(async () => { await call(`/admin/accounts/${encodeURIComponent(account.id)}`, 'PUT', change); notify(done); await load(); }),
    removeLinks: account => attempt(async () => {
      if (!window.confirm(t('Delete all links of {0}? They stop working immediately and cannot be restored.', accountName(account)))) return;
      for (let round = 0; round < 40; round++) { const { removed } = await (await call(`/admin/accounts/${encodeURIComponent(account.id)}/shares`, 'DELETE')).json() as { removed: number }; if (!removed) break; }
      notify(t('All links of {0} deleted.', accountName(account))); await load();
    }),
    removeLink: share => attempt(async () => {
      if (!window.confirm(share.mine ? t('Delete your link now? It stops working immediately.') : t('Delete another person’s link? It stops working immediately and cannot be restored.'))) return;
      await call(`/${share.id}`, 'DELETE'); notify(t('Share link deleted.')); await load();
    }),
  };
  const saveSettings = (settings: Settings) => attempt(async () => { await call('/admin/limits', 'PUT', settings); notify(t('Limits saved. They apply to the next upload.')); await load(); });

  const heading = <PageHeading eyebrow={t('Sharing service')} title={t('Admin')} description={t('Statistics, limits, accounts and links. Projects stay encrypted, also for you.')} action={token ? <button className="button" disabled={busy} onClick={() => void load()}>{busy ? <LoaderCircle size={15} className="spin"/> : <RefreshCw size={15}/>} {t('Refresh')}</button> : undefined}/>;
  // Nothing is shown before the server has confirmed the rights.
  if (!token || (!data && !error)) return <div className="shared-state" role="status"><LoaderCircle className="spin" size={24}/></div>;
  const totals = data?.totals;
  const names: Record<Tab, string> = { overview: t('Overview'), accounts: t('Accounts'), links: t('Links'), limits: t('Limits'), log: t('History') };
  const counts: Partial<Record<Tab, number>> = data ? { accounts: data.accounts.length, links: data.shares.length } : {};
  const tabKeys = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]!;
    setTab(next); document.getElementById(`admin-tab-${next}`)?.focus();
  };
  const visits = visitNumbers(data?.visits);
  return <div className="admin-page">
    {heading}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    {!data && !error && <div className="shared-state" role="status"><LoaderCircle className="spin" size={24}/><p>{t('Loading the statistics…')}</p></div>}
    {data && totals && <>
      <div className="admin-tabs" role="tablist" aria-label={t('Admin')} onKeyDown={tabKeys}>{TABS.map(id => <button key={id} id={`admin-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="admin-panel" tabIndex={tab === id ? 0 : -1} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{names[id]}{counts[id] !== undefined && <small>{number(counts[id]!)}</small>}</button>)}</div>
      <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
        {tab === 'overview' && <>
          {data.visits && <section className="admin-visits"><h2>{t('Visitors')}</h2>
            <dl className="admin-stats">
              <div><dt>{t('Today')}</dt><dd>{number(visits.today)}</dd></div>
              <div><dt>{t('Per day')}</dt><dd>{number(visits.average)} <small>{t('average, 30 days')}</small></dd></div>
              <div><dt>{t('Best day')}</dt><dd>{number(visits.best)} <small>{visits.bestDay ? shortDay(visits.bestDay) : ''}</small></dd></div>
              <div><dt>{t('Opened today')}</dt><dd>{number(visits.opensToday)}</dd></div>
            </dl>
            <div className="admin-charts"><DayChart title={t('Visitors per day')} days={data.visits} value={byVisitors}/><DayChart title={t('Times opened')} days={data.visits} value={byOpens}/></div>
            <p className="muted-text">{t('Counted once per day, device and connection, without cookies. A person with two devices counts twice. Who turned counting off or is offline is missing.')}</p>
          </section>}
          <dl className="admin-stats">
            <div><dt>{t('Accounts')}</dt><dd>{number(totals.accounts)} <small>{t('{0} this week', number(totals.activeWeek))}</small></dd></div>
            <div><dt>{t('Active links')}</dt><dd>{number(totals.links)}</dd></div>
            <div><dt>{t('Uploads today')}</dt><dd>{number(totals.uploadsToday)}</dd></div>
            <div><dt>{t('Downloads')}</dt><dd>{number(data.days.reduce((sum, day) => sum + day.downloads, 0))} <small>{t('30 days')}</small></dd></div>
            <div><dt>{t('AI projects')}</dt><dd>{number(data.ai.projects)} <small>{plural(data.ai.connections, '{0} connection', '{0} connections', number(data.ai.connections))}</small></dd></div>
            <div><dt>{t('AI changes')}</dt><dd>{number(data.ai.changes)} <small>{t('30 days')}</small></dd></div>
            <div><dt>{t('AI storage')}</dt><dd>{bytes(data.ai.bytes)}</dd></div>
            <div><dt>{t('Blocked')}</dt><dd>{number(totals.blocked)}</dd></div>
          </dl>
          <div className="panel admin-meters"><Meter label={t('Storage')} value={totals.bytes} max={totals.limitBytes} format={bytes}/><Meter label={t('Uploads today')} value={totals.uploadsToday} max={totals.uploadsLimit} format={number}/></div>
          {data.databases && <div className="panel admin-meters">{data.databases.map((database, index) => <Meter key={database.name} label={t('Database {0}', index + 1)} value={database.bytes} max={database.capBytes} format={bytes}/>)}{data.kv && <Meter label={t('Large links')} value={data.kv.bytes} max={data.kv.capBytes} format={bytes}/>}</div>}
          <div className="admin-charts">
            <DayChart title={t('Uploads')} days={data.days} value={byUploads}/>
            <DayChart title={t('Downloads')} days={data.days} value={byDownloads}/>
            <DayChart title={t('Sign-ins')} days={data.days} value={bySignIns}/>
            <DayChart title={t('Uploaded data')} days={data.days} value={byBytes} format={bytes}/>
          </div>
          <details className="panel admin-table"><summary>{t('Show the numbers as a table')}</summary><div className="admin-table-scroll"><table><thead><tr><th>{t('Day')}</th><th>{t('Uploads')}</th><th>{t('Uploaded data')}</th><th>{t('Downloads')}</th><th>{t('Sign-ins')}</th><th>{t('New accounts')}</th></tr></thead><tbody>{[...data.days].reverse().map(day => <tr key={day.day}><th scope="row">{shortDay(day.day)}</th><td>{number(day.uploads)}</td><td>{bytes(day.bytes)}</td><td>{number(day.downloads)}</td><td>{number(day.signIns)}</td><td>{number(day.accounts)}</td></tr>)}</tbody></table></div>{!data.days.length && <p>{t('Counting starts with the next sign-in or upload.')}</p>}</details>
        </>}
        {tab === 'accounts' && <Accounts data={data} act={act}/>}
        {tab === 'links' && <Links data={data} act={act}/>}
        {tab === 'limits' && <LimitsEditor data={data} save={saveSettings}/>}
        {tab === 'log' && (data.log.length ? <ul className="admin-log panel">{data.log.map((entry, index) => <li key={`${entry.at}-${index}`}><span><b>{ACTION_TEXT[entry.action] ?? entry.action}</b>{entry.action !== 'limits' && <small>{entry.target.replace(/^firebase:/, '')}</small>}</span><small>{entry.admin} · {moment(entry.at)}</small></li>)}</ul> : <EmptyState icon={ShieldCheck} title={t('Nothing changed yet')} detail={t('Every change an admin makes is listed here.')}/>)}
      </div>
    </>}
  </div>;
}

const byVisitors = (day: { visitors: number }) => day.visitors;
const byOpens = (day: { opens: number }) => day.opens;
const byUploads = (day: Day) => day.uploads;
const byDownloads = (day: Day) => day.downloads;
const bySignIns = (day: Day) => day.signIns;
const byBytes = (day: Day) => day.bytes;
