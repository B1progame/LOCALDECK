/* Limits, accounts, statistics and stored shares. Everything that talks to D1 and KV for them lives here. */

import { BLOB_TABLE, indexBlob, KV_STORE, MAX_BLOB_BYTES, putBlob, removeBlob, sweepBlobs, usage, type BlobEnv } from './blobs.ts';

export type StoreEnv = BlobEnv;
export type Owner = { id: string; email: string; name: string; picture: string; provider: string; admin: boolean };
export type Limits = { linkMiB: number; storageMiB: number; perHour: number; perDay: number; days: number; aiPerDay: number; aiDays: number };
export type ServiceLimits = { totalMiB: number; perDay: number; open: boolean; ai: boolean };
export type Settings = { users: Limits; admins: Limits; service: ServiceLimits };

export const MIB = 1024 * 1024;
/** Large projects arrive in parts, because one KV value holds at most 25 MiB. */
export const PART_BYTES = 20 * MIB;
/** One upload without parts may be as large as before. */
export const SINGLE_BYTES = 24 * MIB;
/** The free KV plan holds 1 GB. */
export const MAX_KV_BYTES = 900 * MIB;
/** What KV holds. A large AI project counts twice, because its version before the last change stays for a while. */
export const KV_USED = `SELECT COALESCE(SUM(shares.size_bytes * (CASE WHEN blob_index.store = ${KV_STORE} THEN 2 ELSE 1 END)), 0) as bytes FROM shares LEFT JOIN blob_index ON blob_index.id = shares.id WHERE shares.expires_at > ?1 AND (blob_index.store IS NULL OR blob_index.store = ${KV_STORE})`;
const PENDING_MS = 15 * 60_000;
const MAX_PENDING_PER_OWNER = 3;
const MAX_PENDING = 8;

export const DEFAULTS: Settings = {
  users: { linkMiB: 24, storageMiB: 100, perHour: 5, perDay: 15, days: 3, aiPerDay: 150, aiDays: 60 },
  admins: { linkMiB: 80, storageMiB: 400, perHour: 100, perDay: 200, days: 7, aiPerDay: 600, aiDays: 180 },
  service: { totalMiB: 1200, perDay: 100, open: true, ai: true },
};
/** What the free plans of Cloudflare and the app itself can carry. KV has 1 GB and 1,000 writes a day. */
export const BOUNDS = { linkMiB: [1, 80], storageMiB: [1, 900], perHour: [1, 200], perDay: [1, 500], days: [1, 30], aiPerDay: [0, 1000], aiDays: [1, 180], totalMiB: [50, 1800], servicePerDay: [1, 800] } as const;

/* The D1 schema (mirrors cloudflare/schema.sql). Every statement is idempotent. */
export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS shares ( id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK (size_bytes > 0) )",
  'CREATE INDEX IF NOT EXISTS shares_expiration_idx ON shares(expires_at)',
  'CREATE INDEX IF NOT EXISTS shares_owner_idx ON shares(owner_id, created_at DESC)',
  'CREATE TABLE IF NOT EXISTS share_meta ( id TEXT PRIMARY KEY, parts INTEGER NOT NULL DEFAULT 1, received INTEGER NOT NULL DEFAULT 0, downloads INTEGER NOT NULL DEFAULT 0, last_download INTEGER )',
  'CREATE TABLE IF NOT EXISTS accounts ( owner_id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, sign_ins INTEGER NOT NULL DEFAULT 0, uploads INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, downloads INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, limits TEXT )',
  'CREATE TABLE IF NOT EXISTS daily_stats ( day INTEGER PRIMARY KEY, uploads INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, downloads INTEGER NOT NULL DEFAULT 0, sign_ins INTEGER NOT NULL DEFAULT 0, accounts INTEGER NOT NULL DEFAULT 0 )',
  'CREATE TABLE IF NOT EXISTS service_settings ( id TEXT PRIMARY KEY, value TEXT NOT NULL )',
  'CREATE TABLE IF NOT EXISTS admin_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, admin TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL )',
  'CREATE TABLE IF NOT EXISTS ai_tokens ( id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER, calls INTEGER NOT NULL DEFAULT 0 )',
  'CREATE TABLE IF NOT EXISTS ai_projects ( id TEXT PRIMARY KEY, token_id TEXT NOT NULL, sealed TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL, claim INTEGER )',
  'CREATE TABLE IF NOT EXISTS blob_index ( id TEXT PRIMARY KEY, store INTEGER NOT NULL, version INTEGER NOT NULL, bytes INTEGER NOT NULL )',
  BLOB_TABLE,
  'CREATE INDEX IF NOT EXISTS ai_projects_token_idx ON ai_projects(token_id)',
  'CREATE TABLE IF NOT EXISTS ai_daily ( day INTEGER PRIMARY KEY, created INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0 )',
  'CREATE TABLE IF NOT EXISTS upload_windows ( owner_id TEXT NOT NULL, window_start INTEGER NOT NULL, uploads INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner_id, window_start) )',
  'CREATE TABLE IF NOT EXISTS daily_upload_windows ( owner_id TEXT NOT NULL, window_start INTEGER NOT NULL, uploads INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner_id, window_start) )',
  'CREATE TABLE IF NOT EXISTS global_upload_windows ( window_start INTEGER PRIMARY KEY, uploads INTEGER NOT NULL DEFAULT 0 )',
  'CREATE TABLE IF NOT EXISTS auth_windows ( client_hash TEXT NOT NULL, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (client_hash, window_start) )',
  'CREATE TABLE IF NOT EXISTS read_windows ( client_hash TEXT NOT NULL, window_start INTEGER NOT NULL, reads INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (client_hash, window_start) )',
  'CREATE TABLE IF NOT EXISTS verification_mails ( owner_id TEXT PRIMARY KEY, sent_at INTEGER NOT NULL )',
  'CREATE TABLE IF NOT EXISTS mail_windows ( window_start INTEGER PRIMARY KEY, sent INTEGER NOT NULL DEFAULT 0 )',
];

export const hourStart = (time = Date.now()) => Math.floor(time / 3_600_000) * 3_600_000;
export const dayStart = (time = Date.now()) => Math.floor(time / 86_400_000) * 86_400_000;
const nowIso = () => new Date().toISOString();

/* ---------- Settings ---------- */

function whole(value: unknown, fallback: number, [min, max]: readonly [number, number]): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
export function cleanLimits(value: unknown, fallback: Limits): Limits {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return { linkMiB: whole(input.linkMiB, fallback.linkMiB, BOUNDS.linkMiB), storageMiB: whole(input.storageMiB, fallback.storageMiB, BOUNDS.storageMiB), perHour: whole(input.perHour, fallback.perHour, BOUNDS.perHour), perDay: whole(input.perDay, fallback.perDay, BOUNDS.perDay), days: whole(input.days, fallback.days, BOUNDS.days), aiPerDay: whole(input.aiPerDay, fallback.aiPerDay, BOUNDS.aiPerDay), aiDays: whole(input.aiDays, fallback.aiDays, BOUNDS.aiDays) };
}
export function cleanSettings(value: unknown, fallback: Settings = DEFAULTS): Settings {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const service = (input.service && typeof input.service === 'object' ? input.service : {}) as Record<string, unknown>;
  return {
    users: cleanLimits(input.users, fallback.users),
    admins: cleanLimits(input.admins, fallback.admins),
    service: { totalMiB: whole(service.totalMiB, fallback.service.totalMiB, BOUNDS.totalMiB), perDay: whole(service.perDay, fallback.service.perDay, BOUNDS.servicePerDay), open: typeof service.open === 'boolean' ? service.open : fallback.service.open, ai: typeof service.ai === 'boolean' ? service.ai : fallback.service.ai },
  };
}
export async function readSettings(env: StoreEnv): Promise<Settings> {
  const row = await env.SHARES_DB.prepare("SELECT value FROM service_settings WHERE id = 'limits'").first<{ value: string }>();
  try { return cleanSettings(row ? JSON.parse(row.value) : {}); } catch { return DEFAULTS; }
}
export async function writeSettings(env: StoreEnv, settings: Settings): Promise<void> {
  await env.SHARES_DB.prepare("INSERT INTO service_settings (id, value) VALUES ('limits', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value").bind(JSON.stringify(settings)).run();
}

/* ---------- Accounts and statistics ---------- */

type AccountRow = { blocked: number; limits: string | null };
type Counter = 'uploads' | 'bytes' | 'downloads' | 'sign_ins' | 'accounts';

async function count(env: StoreEnv, values: Partial<Record<Counter, number>>): Promise<void> {
  const keys = Object.keys(values) as Counter[];
  await env.SHARES_DB.prepare(`INSERT INTO daily_stats (day, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')}) ON CONFLICT(day) DO UPDATE SET ${keys.map(key => `${key} = ${key} + excluded.${key}`).join(', ')}`).bind(dayStart(), ...keys.map(key => values[key]!)).run();
}

/** Records a sign-in. False means an admin blocked this account. */
export async function recordSignIn(env: StoreEnv, owner: Owner): Promise<boolean> {
  const now = Date.now();
  const before = await env.SHARES_DB.prepare('SELECT blocked, limits FROM accounts WHERE owner_id = ?').bind(owner.id).first<AccountRow>();
  if (before?.blocked && !owner.admin) return false;
  await env.SHARES_DB.prepare('INSERT INTO accounts (owner_id, email, name, provider, first_seen, last_seen, sign_ins) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(owner_id) DO UPDATE SET email = excluded.email, name = excluded.name, provider = excluded.provider, last_seen = excluded.last_seen, sign_ins = sign_ins + 1').bind(owner.id, owner.email, owner.name, owner.provider, now, now).run();
  await count(env, before ? { sign_ins: 1 } : { sign_ins: 1, accounts: 1 });
  return true;
}

export async function limitsFor(env: StoreEnv, owner: Owner, settings: Settings): Promise<{ limits: Limits; blocked: boolean }> {
  const row = await env.SHARES_DB.prepare('SELECT blocked, limits FROM accounts WHERE owner_id = ?').bind(owner.id).first<AccountRow>();
  const base = owner.admin ? settings.admins : settings.users;
  let limits = base;
  if (row?.limits) try { limits = cleanLimits(JSON.parse(row.limits), base); } catch { /* keep the general limits */ }
  return { limits, blocked: Boolean(row?.blocked) && !owner.admin };
}

async function windowCount(env: StoreEnv, table: 'upload_windows' | 'daily_upload_windows', ownerId: string, start: number): Promise<number> {
  return (await env.SHARES_DB.prepare(`SELECT uploads FROM ${table} WHERE owner_id = ? AND window_start = ?`).bind(ownerId, start).first<{ uploads: number }>())?.uploads ?? 0;
}

export async function usageFor(env: StoreEnv, owner: Owner): Promise<{ bytes: number; links: number; hour: number; day: number }> {
  const row = await env.SHARES_DB.prepare("SELECT COUNT(*) as links, COALESCE(SUM(size_bytes), 0) as bytes FROM shares WHERE owner_id = ? AND status = 'active' AND expires_at > ?").bind(owner.id, nowIso()).first<{ links: number; bytes: number }>();
  return { bytes: row?.bytes ?? 0, links: row?.links ?? 0, hour: await windowCount(env, 'upload_windows', owner.id, hourStart()), day: await windowCount(env, 'daily_upload_windows', owner.id, dayStart()) };
}

/* ---------- Uploads ---------- */

export type Reservation = { id: string; expiresAt: string; ttl: number };

/** Checks every limit and reserves the space. The reservation is one INSERT, so parallel uploads cannot pass the limit together. */
export async function reserve(env: StoreEnv, owner: Owner, size: number, parts: number): Promise<Reservation | { error: string; status: number }> {
  const settings = await readSettings(env);
  const { limits, blocked } = await limitsFor(env, owner, settings);
  if (blocked) return { error: 'blocked', status: 403 };
  if (!settings.service.open && !owner.admin) return { error: 'uploads_paused', status: 503 };
  if (size > limits.linkMiB * MIB) return { error: 'invalid_size', status: 413 };

  const db = env.SHARES_DB;
  await db.prepare('INSERT INTO upload_windows (owner_id, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(owner_id, window_start) DO UPDATE SET uploads = uploads + 1').bind(owner.id, hourStart()).run();
  if (await windowCount(env, 'upload_windows', owner.id, hourStart()) > limits.perHour) return { error: 'rate_limited', status: 429 };
  await db.prepare('INSERT INTO daily_upload_windows (owner_id, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(owner_id, window_start) DO UPDATE SET uploads = uploads + 1').bind(owner.id, dayStart()).run();
  if (await windowCount(env, 'daily_upload_windows', owner.id, dayStart()) > limits.perDay) return { error: 'daily_rate_limited', status: 429 };
  await db.prepare('INSERT INTO global_upload_windows (window_start, uploads) VALUES (?, 1) ON CONFLICT(window_start) DO UPDATE SET uploads = uploads + 1').bind(dayStart()).run();
  const today = (await db.prepare('SELECT uploads FROM global_upload_windows WHERE window_start = ?').bind(dayStart()).first<{ uploads: number }>())?.uploads ?? 0;
  if (!owner.admin && today > settings.service.perDay) return { error: 'daily_rate_limited', status: 429 };

  const id = crypto.randomUUID();
  const ttl = limits.days * 86_400;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  const recent = new Date(now.getTime() - PENDING_MS).toISOString();
  const created = await db.prepare(`INSERT INTO shares (id, owner_id, status, created_at, expires_at, size_bytes)
    SELECT ?1, ?2, 'revoked', ?3, ?4, ?5
    WHERE (SELECT COALESCE(SUM(size_bytes), 0) FROM shares WHERE expires_at > ?3) + ?5 <= ?6
      AND (SELECT COALESCE(SUM(size_bytes), 0) FROM shares WHERE expires_at > ?3 AND owner_id = ?2) + ?5 <= ?7
      AND (?5 <= ?11 OR (${KV_USED.replace('?1', '?3')}) + ?5 <= ?12)
      AND (SELECT COUNT(*) FROM shares WHERE status = 'revoked' AND created_at > ?8) < ?9
      AND (SELECT COUNT(*) FROM shares WHERE status = 'revoked' AND created_at > ?8 AND owner_id = ?2) < ?10
    RETURNING id`).bind(id, owner.id, now.toISOString(), expiresAt, size, settings.service.totalMiB * MIB, limits.storageMiB * MIB, recent, MAX_PENDING, MAX_PENDING_PER_OWNER, MAX_BLOB_BYTES, MAX_KV_BYTES).first<{ id: string }>();
  if (!created) {
    const mine = (await db.prepare('SELECT COALESCE(SUM(size_bytes), 0) as bytes FROM shares WHERE expires_at > ? AND owner_id = ?').bind(nowIso(), owner.id).first<{ bytes: number }>())?.bytes ?? 0;
    return { error: mine + size > limits.storageMiB * MIB ? 'user_storage_limit' : 'storage_or_upload_limit', status: 429 };
  }
  await db.prepare('INSERT INTO share_meta (id, parts) VALUES (?, ?)').bind(id, parts).run();
  return { id, expiresAt, ttl };
}

export const partKey = (id: string, part: number) => part ? `${id}.${part}` : id;

async function singlePart(env: StoreEnv, id: string): Promise<boolean> {
  return (await env.SHARES_DB.prepare('SELECT parts FROM share_meta WHERE id = ?').bind(id).first<{ parts: number }>())?.parts === 1;
}

/** Stores one part. The share becomes active as soon as all parts are there. */
export async function storePart(env: StoreEnv, owner: Owner, id: string, part: number, bytes: ArrayBuffer, ttl: number): Promise<boolean> {
  // Small projects go into the databases: they are there at once everywhere and do not use up the KV writes.
  const store = part === 0 && bytes.byteLength <= MAX_BLOB_BYTES && await singlePart(env, id) ? await putBlob(env, id, 1, new Uint8Array(bytes)) : null;
  if (store === null) await env.SHARES_KV.put(partKey(id, part), bytes, { expirationTtl: ttl });
  else await indexBlob(env, id, store, 1, bytes.byteLength);
  const meta = await env.SHARES_DB.prepare('UPDATE share_meta SET received = received | ? WHERE id = ? RETURNING parts, received').bind(1 << part, id).first<{ parts: number; received: number }>();
  if (!meta || meta.received !== (1 << meta.parts) - 1) return false;
  const active = await env.SHARES_DB.prepare("UPDATE shares SET status = 'active' WHERE id = ? AND owner_id = ? AND status = 'revoked' RETURNING size_bytes").bind(id, owner.id).first<{ size_bytes: number }>();
  if (!active) return false;
  await env.SHARES_DB.prepare('INSERT INTO accounts (owner_id, email, name, provider, first_seen, last_seen, uploads, bytes) VALUES (?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(owner_id) DO UPDATE SET uploads = uploads + 1, bytes = bytes + excluded.bytes, last_seen = excluded.last_seen').bind(owner.id, owner.email, owner.name, owner.provider, Date.now(), Date.now(), active.size_bytes).run();
  await count(env, { uploads: 1, bytes: active.size_bytes });
  return true;
}

export async function pendingShare(env: StoreEnv, owner: Owner, id: string): Promise<{ size: number; parts: number; ttl: number } | null> {
  const row = await env.SHARES_DB.prepare("SELECT shares.size_bytes as size, shares.expires_at as expiresAt, share_meta.parts as parts FROM shares JOIN share_meta ON share_meta.id = shares.id WHERE shares.id = ? AND shares.owner_id = ? AND shares.status = 'revoked' AND shares.created_at > ?").bind(id, owner.id, new Date(Date.now() - 2 * PENDING_MS).toISOString()).first<{ size: number; parts: number; expiresAt: string }>();
  return row ? { size: row.size, parts: row.parts, ttl: Math.max(60, Math.floor((Date.parse(row.expiresAt) - Date.now()) / 1000)) } : null;
}

/** Size that a part must have, so a share cannot grow beyond its reservation. */
export const partSize = (total: number, parts: number, part: number) => parts === 1 ? total : part < parts - 1 ? PART_BYTES : total - PART_BYTES * (parts - 1);

export async function countDownload(env: StoreEnv, id: string, ownerId: string): Promise<void> {
  await env.SHARES_DB.prepare('INSERT INTO share_meta (id, downloads, last_download) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET downloads = downloads + 1, last_download = excluded.last_download').bind(id, Date.now()).run();
  await env.SHARES_DB.prepare('UPDATE accounts SET downloads = downloads + 1 WHERE owner_id = ?').bind(ownerId).run();
  await count(env, { downloads: 1 });
}

/** Blocks downloads at once, then removes the data. A row that could not be removed is retried by the cleanup. */
export async function removeShare(env: StoreEnv, id: string, ownerId: string | null): Promise<boolean> {
  const row = await env.SHARES_DB.prepare("UPDATE shares SET status = 'revoked' WHERE id = ?1 AND (?2 IS NULL OR owner_id = ?2) RETURNING id").bind(id, ownerId).first<{ id: string }>();
  if (!row) return false;
  try {
    await env.SHARES_DB.prepare('DELETE FROM ai_projects WHERE id = ?').bind(id).run();
    const parts = await removeBlob(env, id) ? 0 : (await env.SHARES_DB.prepare('SELECT parts FROM share_meta WHERE id = ?').bind(id).first<{ parts: number }>())?.parts ?? 1;
    for (let part = 0; part < parts; part++) await env.SHARES_KV.delete(partKey(id, part));
    await env.SHARES_DB.prepare('DELETE FROM shares WHERE id = ?').bind(id).run();
    await env.SHARES_DB.prepare('DELETE FROM share_meta WHERE id = ?').bind(id).run();
  } catch (error) { console.error('share_remove_failed', error); }
  return true;
}

export async function cleanup(env: StoreEnv): Promise<void> {
  const db = env.SHARES_DB;
  // KV drops the data of expired links by itself.
  await db.prepare('DELETE FROM shares WHERE expires_at <= ?').bind(nowIso()).run();
  const stale = await db.prepare("SELECT id FROM shares WHERE status = 'revoked' AND created_at < ? LIMIT 2").bind(new Date(Date.now() - 3 * PENDING_MS).toISOString()).all<{ id: string }>();
  for (const { id } of stale.results) await removeShare(env, id, null);
  await db.prepare('DELETE FROM ai_projects WHERE NOT EXISTS (SELECT 1 FROM shares WHERE shares.id = ai_projects.id)').run();
  await sweepBlobs(env);
  await db.prepare('DELETE FROM ai_daily WHERE day < ?').bind(Date.now() - 400 * 86_400_000).run();
  await db.prepare('DELETE FROM ai_tokens WHERE COALESCE(last_used, created_at) < ? OR NOT EXISTS (SELECT 1 FROM accounts WHERE accounts.owner_id = ai_tokens.owner_id)').bind(Date.now() - 180 * 86_400_000).run();
  await db.prepare('DELETE FROM share_meta WHERE NOT EXISTS (SELECT 1 FROM shares WHERE shares.id = share_meta.id)').run();
  const old = Date.now() - 48 * 3_600_000, week = Date.now() - 8 * 86_400_000;
  for (const table of ['upload_windows', 'auth_windows', 'read_windows']) await db.prepare(`DELETE FROM ${table} WHERE window_start < ?`).bind(old).run();
  for (const table of ['daily_upload_windows', 'global_upload_windows', 'mail_windows']) await db.prepare(`DELETE FROM ${table} WHERE window_start < ?`).bind(week).run();
  await db.prepare('DELETE FROM verification_mails WHERE sent_at < ?').bind(old).run();
  await db.prepare('DELETE FROM daily_stats WHERE day < ?').bind(Date.now() - 400 * 86_400_000).run();
  await db.prepare('DELETE FROM admin_log WHERE id <= (SELECT MAX(id) FROM admin_log) - 500').run();
  // Personal data of people who have not signed in for half a year is not kept. Blocked accounts stay blocked.
  await db.prepare('DELETE FROM accounts WHERE last_seen < ? AND blocked = 0 AND limits IS NULL AND NOT EXISTS (SELECT 1 FROM shares WHERE shares.owner_id = accounts.owner_id)').bind(Date.now() - 180 * 86_400_000).run();
}

/** Counts a change by an AI. A new project also counts as an upload of the account. */
export async function recordAi(env: StoreEnv, connection: { id: string; owner: Owner }, createdBytes: number): Promise<void> {
  const created = createdBytes > 0 ? 1 : 0;
  await env.SHARES_DB.prepare('INSERT INTO ai_daily (day, created, updated) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET created = created + excluded.created, updated = updated + excluded.updated').bind(dayStart(), created, 1 - created).run();
  if (!created) return;
  await env.SHARES_DB.prepare('UPDATE accounts SET uploads = uploads + 1, bytes = bytes + ? WHERE owner_id = ?').bind(createdBytes, connection.owner.id).run();
  await count(env, { uploads: 1, bytes: createdBytes });
}

/* ---------- Admin ---------- */

async function log(env: StoreEnv, admin: Owner, action: string, target: string): Promise<void> {
  await env.SHARES_DB.prepare('INSERT INTO admin_log (at, admin, action, target) VALUES (?, ?, ?, ?)').bind(Date.now(), admin.email, action, target.slice(0, 200)).run();
}

/** Everything the admin page shows. Project contents and names are not part of it: the server does not know them. */
export async function overview(env: StoreEnv, owner: Owner): Promise<unknown> {
  const db = env.SHARES_DB, now = nowIso(), today = dayStart();
  const settings = await readSettings(env);
  const totals = await db.prepare("SELECT COUNT(*) as links, COALESCE(SUM(size_bytes), 0) as bytes FROM shares WHERE status = 'active' AND expires_at > ?").bind(now).first<{ links: number; bytes: number }>();
  const people = await db.prepare('SELECT COUNT(*) as accounts, COALESCE(SUM(last_seen > ?), 0) as week, COALESCE(SUM(blocked), 0) as blocked FROM accounts').bind(Date.now() - 7 * 86_400_000).first<{ accounts: number; week: number; blocked: number }>();
  const uploads = await db.prepare('SELECT uploads FROM global_upload_windows WHERE window_start = ?').bind(today).first<{ uploads: number }>();
  const days = await db.prepare('SELECT day, uploads, bytes, downloads, sign_ins as signIns, accounts FROM daily_stats WHERE day > ? ORDER BY day').bind(today - 30 * 86_400_000).all<Record<string, number>>();
  const accounts = await db.prepare(`SELECT ids.owner_id as id, accounts.email, accounts.name, accounts.provider, accounts.first_seen as firstSeen, accounts.last_seen as lastSeen, COALESCE(accounts.sign_ins, 0) as signIns, COALESCE(accounts.uploads, 0) as uploads, COALESCE(accounts.bytes, 0) as uploadedBytes, COALESCE(accounts.downloads, 0) as downloads, COALESCE(accounts.blocked, 0) as blocked, accounts.limits,
      (SELECT COUNT(*) FROM shares WHERE shares.owner_id = ids.owner_id AND status = 'active' AND expires_at > ?1) as links,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM shares WHERE shares.owner_id = ids.owner_id AND status = 'active' AND expires_at > ?1) as bytes
    FROM (SELECT owner_id FROM accounts UNION SELECT owner_id FROM shares WHERE expires_at > ?1) ids LEFT JOIN accounts ON accounts.owner_id = ids.owner_id
    ORDER BY accounts.last_seen DESC LIMIT 500`).bind(now).all<Record<string, unknown> & { id: string; limits: string | null; blocked: number }>();
  const shares = await db.prepare(`SELECT shares.id, shares.owner_id as ownerId, accounts.email as owner, shares.created_at as createdAt, shares.expires_at as expiresAt, shares.size_bytes as sizeBytes, COALESCE(share_meta.downloads, 0) as downloads, share_meta.last_download as lastDownload, EXISTS (SELECT 1 FROM ai_projects WHERE ai_projects.id = shares.id) as ai
    FROM shares LEFT JOIN accounts ON accounts.owner_id = shares.owner_id LEFT JOIN share_meta ON share_meta.id = shares.id
    WHERE shares.status = 'active' AND shares.expires_at > ? ORDER BY shares.created_at DESC LIMIT 300`).bind(now).all<{ ownerId: string; ai: number }>();
  const ai = await db.prepare('SELECT (SELECT COUNT(*) FROM ai_tokens) as connections, (SELECT COUNT(*) FROM ai_projects JOIN shares ON shares.id = ai_projects.id WHERE shares.expires_at > ?1) as projects, (SELECT COALESCE(SUM(size_bytes), 0) FROM shares JOIN ai_projects ON ai_projects.id = shares.id WHERE shares.expires_at > ?1) as bytes, (SELECT COALESCE(SUM(created + updated), 0) FROM ai_daily WHERE day > ?2) as changes').bind(now, today - 30 * 86_400_000).first();
  const kv = await db.prepare(KV_USED).bind(now).first<{ bytes: number }>();
  const entries = await db.prepare('SELECT at, admin, action, target FROM admin_log ORDER BY id DESC LIMIT 30').bind().all();
  return {
    totals: { links: totals?.links ?? 0, owners: new Set(shares.results.map(share => share.ownerId)).size, bytes: totals?.bytes ?? 0, limitBytes: settings.service.totalMiB * MIB, uploadsToday: uploads?.uploads ?? 0, uploadsLimit: settings.service.perDay, accounts: people?.accounts ?? 0, activeWeek: people?.week ?? 0, blocked: people?.blocked ?? 0 },
    ai, databases: (await usage(env)).map(({ name, bytes, projects, capBytes }) => ({ name, bytes, projects, capBytes })), kv: { bytes: kv?.bytes ?? 0, capBytes: MAX_KV_BYTES },
    settings, defaults: DEFAULTS, bounds: BOUNDS, days: days.results,
    accounts: accounts.results.map(account => { let limits: unknown = null; try { limits = account.limits ? JSON.parse(account.limits) : null; } catch { /* broken override */ } return { ...account, limits, blocked: Boolean(account.blocked), mine: account.id === owner.id }; }),
    shares: shares.results.map(share => ({ ...share, ai: Boolean(share.ai), mine: share.ownerId === owner.id })),
    log: entries.results,
  };
}

export async function changeSettings(env: StoreEnv, admin: Owner, value: unknown): Promise<Settings> {
  const settings = cleanSettings(value, await readSettings(env));
  await writeSettings(env, settings);
  await log(env, admin, 'limits', JSON.stringify(settings));
  return settings;
}

export async function changeAccount(env: StoreEnv, admin: Owner, id: string, value: { blocked?: unknown; limits?: unknown }): Promise<boolean> {
  const account = await env.SHARES_DB.prepare('SELECT email FROM accounts WHERE owner_id = ?').bind(id).first<{ email: string }>();
  if (!account) return false;
  if (typeof value.blocked === 'boolean') {
    if (id === admin.id) return false;
    await env.SHARES_DB.prepare('UPDATE accounts SET blocked = ? WHERE owner_id = ?').bind(value.blocked ? 1 : 0, id).run();
    await log(env, admin, value.blocked ? 'block' : 'unblock', account.email);
  }
  if (value.limits === null || (value.limits && typeof value.limits === 'object')) {
    const limits = value.limits === null ? null : JSON.stringify(cleanLimits(value.limits, (await readSettings(env)).users));
    await env.SHARES_DB.prepare('UPDATE accounts SET limits = ? WHERE owner_id = ?').bind(limits, id).run();
    await log(env, admin, limits ? 'account_limits' : 'account_limits_reset', account.email);
  }
  return true;
}

/** At most 8 links per call, so one request stays within the limits of the free plan. */
export async function removeAccountShares(env: StoreEnv, admin: Owner, id: string): Promise<number> {
  const rows = await env.SHARES_DB.prepare('SELECT id FROM shares WHERE owner_id = ? LIMIT 8').bind(id).all<{ id: string }>();
  for (const row of rows.results) await removeShare(env, row.id, id);
  await log(env, admin, 'delete_links', id);
  return rows.results.length;
}

export async function logShareRemoval(env: StoreEnv, admin: Owner, id: string): Promise<void> { await log(env, admin, 'delete_link', id); }
