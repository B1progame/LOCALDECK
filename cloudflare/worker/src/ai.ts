/* Projects that an AI creates over MCP, and the connections (tokens) that allow it.

   Nothing readable is stored. A project is a ZIP, encrypted exactly like a share from the browser, so the
   normal share link opens it. Its key and title are stored only encrypted with a key that is derived from the
   token. The database knows the hash of a token, so without the token itself it cannot read them. */
import { createStoredZip, normalizePackagePath, readZip } from '../../../src/services/zip.ts';
import { dayStart, hourStart, limitsFor, MIB, readSettings, recordAi, removeShare, type Limits, type Owner, type StoreEnv } from './service.ts';

export interface AiEnv extends StoreEnv { APP_URL?: string; ADMIN_EMAILS?: string }
export type Connection = { id: string; owner: Owner; key: CryptoKey; limits: Limits };
export type ProjectFile = { path: string; data: Uint8Array };

/** One database row holds at most 2 MB, and the free plan gives little computing time per request. */
export const MAX_PROJECT_BYTES = MIB;
const MAX_AI_BYTES = 300 * MIB;
const MAX_FILES = 60;
const MAX_CONNECTIONS = 5;
const MAX_CALLS_PER_HOUR = 240;
const TYPES = ['game', 'learning', 'app', 'tool', 'simulation', 'presentation', 'quiz', 'other'];
const encoder = new TextEncoder(), decoder = new TextDecoder();

/** An error whose text is meant for the AI. */
export class AiError extends Error {}

/* ---------- Encoding and keys ---------- */

type Base64Bytes = Uint8Array & { toBase64?: () => string };
function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Base64Bytes).toBase64;
  if (native) return native.call(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(text: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (value: string) => Uint8Array }).fromBase64;
  return native ? native.call(Uint8Array, text) : Uint8Array.from(atob(text), char => char.charCodeAt(0));
}
const toUrl = (text: string) => text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

async function encrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = random(12), sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const result = new Uint8Array(12 + sealed.length);
  result.set(iv); result.set(sealed, 12);
  return result;
}
async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12)));
}
const projectKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
const hash = async (token: string) => toUrl(toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)))));
async function tokenKey(token: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(token), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('localdeck-ai'), info: encoder.encode('projects') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* ---------- Connections ---------- */

export type ConnectionRow = { id: string; name: string; createdAt: number; lastUsed: number | null; calls: number; projects: number };

export async function listConnections(env: AiEnv, owner: Owner): Promise<ConnectionRow[]> {
  return (await env.SHARES_DB.prepare('SELECT id, name, created_at as createdAt, last_used as lastUsed, calls, (SELECT COUNT(*) FROM ai_projects JOIN shares ON shares.id = ai_projects.id WHERE ai_projects.token_id = ai_tokens.id AND shares.expires_at > ?) as projects FROM ai_tokens WHERE owner_id = ? ORDER BY created_at DESC').bind(new Date().toISOString(), owner.id).all<ConnectionRow>()).results;
}

/** Returns the token once. Only its hash is kept. */
export async function createConnection(env: AiEnv, owner: Owner, name: string): Promise<{ id: string; token: string } | null> {
  const token = `ld_${toUrl(toBase64(random(32)))}`, id = crypto.randomUUID();
  const created = await env.SHARES_DB.prepare('INSERT INTO ai_tokens (id, owner_id, hash, name, created_at) SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT COUNT(*) FROM ai_tokens WHERE owner_id = ?2) < ?6 RETURNING id').bind(id, owner.id, await hash(token), name.trim().slice(0, 40) || 'AI', Date.now(), MAX_CONNECTIONS).first<{ id: string }>();
  return created ? { id, token } : null;
}

export async function removeConnection(env: AiEnv, owner: Owner, id: string): Promise<boolean> {
  return Boolean(await env.SHARES_DB.prepare('DELETE FROM ai_tokens WHERE id = ? AND owner_id = ? RETURNING id').bind(id, owner.id).first());
}

/** Null: unknown token. A text: the connection exists but may not be used right now. */
export async function connect(env: AiEnv, token: string, isAdmin: (email: string) => boolean): Promise<Connection | string | null> {
  if (!/^ld_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await env.SHARES_DB.prepare('SELECT ai_tokens.id, ai_tokens.owner_id as ownerId, accounts.email, accounts.name, accounts.provider FROM ai_tokens JOIN accounts ON accounts.owner_id = ai_tokens.owner_id WHERE ai_tokens.hash = ?').bind(await hash(token)).first<{ id: string; ownerId: string; email: string; name: string; provider: string }>();
  if (!row) return null;
  const owner: Owner = { id: row.ownerId, email: row.email, name: row.name, picture: '', provider: row.provider, admin: row.provider === 'google.com' && isAdmin(row.email) };
  const settings = await readSettings(env);
  if (!settings.service.ai && !owner.admin) return 'AI connections are switched off by the operator of this LocalDeck service.';
  const { limits, blocked } = await limitsFor(env, owner, settings);
  if (blocked) return 'This LocalDeck account is blocked.';
  const calls = await env.SHARES_DB.prepare('INSERT INTO upload_windows (owner_id, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(owner_id, window_start) DO UPDATE SET uploads = uploads + 1 RETURNING uploads').bind(`ai-calls:${row.id}`, hourStart()).first<{ uploads: number }>();
  if ((calls?.uploads ?? 0) > MAX_CALLS_PER_HOUR) return 'Too many requests in this hour. Try again later.';
  await env.SHARES_DB.prepare('UPDATE ai_tokens SET last_used = ?, calls = calls + 1 WHERE id = ?').bind(Date.now(), row.id).run();
  return { id: row.id, owner, limits, key: await tokenKey(token) };
}

/* ---------- Files ---------- */

type FileInput = { path?: unknown; content?: unknown; encoding?: unknown };

export function readFiles(value: unknown): ProjectFile[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new AiError('"files" must be a list of { path, content }.');
  return (value as FileInput[]).map(file => {
    if (typeof file?.path !== 'string' || typeof file.content !== 'string') throw new AiError('Every file needs a "path" and a "content" text.');
    let path: string;
    try { path = normalizePackagePath(file.path.trim()); } catch { throw new AiError(`Unsafe file path: ${file.path}. Use relative paths such as assets/logo.svg.`); }
    if (path.length > 200) throw new AiError(`The path is too long: ${path.slice(0, 60)}…`);
    if (file.encoding === undefined || file.encoding === 'utf8') return { path, data: encoder.encode(file.content) };
    if (file.encoding !== 'base64') throw new AiError('"encoding" must be "utf8" or "base64".');
    try { return { path, data: fromBase64(file.content.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')) }; } catch { throw new AiError(`${path} is not valid base64.`); }
  });
}

const TEXT = /\.(html?|css|m?js|json|svg|txt|md|csv|xml)$/i;
const MANIFEST = 'localdeck.json';
export type Details = { title?: string; type?: string; subject?: string; topic?: string; description?: string; tags?: string[]; language?: string };

export function readDetails(input: Record<string, unknown>): Details {
  const details: Details = {};
  for (const key of ['title', 'subject', 'topic', 'description', 'language'] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') throw new AiError(`"${key}" must be a text.`);
    details[key] = (input[key] as string).trim().slice(0, key === 'description' ? 500 : 120);
  }
  if (input.type !== undefined) {
    if (!TYPES.includes(String(input.type))) throw new AiError(`"type" must be one of: ${TYPES.join(', ')}.`);
    details.type = String(input.type);
  }
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || !input.tags.every(tag => typeof tag === 'string')) throw new AiError('"tags" must be a list of texts.');
    details.tags = (input.tags as string[]).slice(0, 12).map(tag => tag.trim().slice(0, 40)).filter(Boolean);
  }
  return details;
}

/** Puts the details into localdeck.json and returns the title. */
function applyDetails(files: Map<string, Uint8Array>, details: Details): string {
  let manifest: Record<string, unknown> = {};
  const existing = files.get(MANIFEST);
  if (existing) {
    try { manifest = JSON.parse(decoder.decode(existing)) as Record<string, unknown>; } catch { throw new AiError('localdeck.json is not valid JSON. Leave it out, LocalDeck writes it for you.'); }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new AiError('localdeck.json must be an object.');
  }
  const title = details.title || (typeof manifest.title === 'string' ? manifest.title : '');
  if (!title) throw new AiError('The project needs a "title".');
  const cover = ['cover.svg', 'cover.png', 'cover.webp', 'cover.jpg'].find(path => files.has(path));
  const merged = { type: 'other', ...manifest, ...details, schemaVersion: 1, title, entry: 'index.html', ...(cover ? { cover } : {}) };
  if (!TYPES.includes(String(merged.type))) merged.type = 'other';
  files.set(MANIFEST, encoder.encode(JSON.stringify(merged, null, 2)));
  return title;
}

async function pack(files: Map<string, Uint8Array>): Promise<Uint8Array> {
  if (!files.has('index.html')) throw new AiError('The project needs an index.html.');
  if (files.size > MAX_FILES) throw new AiError(`A project can have at most ${MAX_FILES} files.`);
  const seen = new Set<string>();
  for (const path of files.keys()) { const lower = path.toLowerCase(); if (seen.has(lower)) throw new AiError(`Two files have the same name: ${path}`); seen.add(lower); }
  const zip = new Uint8Array(await createStoredZip([...files].map(([path, data]) => ({ path, data }))).arrayBuffer());
  if (zip.length > MAX_PROJECT_BYTES) throw new AiError(`The project is ${(zip.length / MIB).toFixed(2)} MiB. The limit for AI projects is 1 MiB. Use SVG instead of photos and fewer embedded files.`);
  return zip;
}

/* ---------- Projects ---------- */

type Sealed = { key: string; title: string };
type Row = { id: string; sealed: string; data: string; version: number; expiresAt: string };
export type ProjectInfo = { id: string; title: string; link: string; expiresAt: string; version: number; size: number };

const link = (env: AiEnv, id: string, key: string) => `${env.APP_URL}#/shared/${id}?k=${key}`;

async function unseal(connection: Connection, text: string): Promise<Sealed> {
  return JSON.parse(decoder.decode(await decrypt(connection.key, fromBase64(text)))) as Sealed;
}
const seal = async (connection: Connection, value: Sealed) => toBase64(await encrypt(connection.key, encoder.encode(JSON.stringify(value))));

async function countWrite(env: AiEnv, connection: Connection): Promise<void> {
  const used = await env.SHARES_DB.prepare('INSERT INTO daily_upload_windows (owner_id, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(owner_id, window_start) DO UPDATE SET uploads = uploads + 1 RETURNING uploads').bind(`ai:${connection.owner.id}`, dayStart()).first<{ uploads: number }>();
  if ((used?.uploads ?? 0) > connection.limits.aiPerDay) throw new AiError(`The limit of ${connection.limits.aiPerDay} AI changes per day is reached. It resets at 00:00 UTC.`);
}

const storageError = () => new AiError('The storage of this account or of the service is full. Delete a project or wait until a link expires.');

export async function createProject(env: AiEnv, connection: Connection, input: ProjectFile[], details: Details): Promise<ProjectInfo> {
  const settings = await readSettings(env);
  if (!settings.service.open && !connection.owner.admin) throw new AiError('New links are paused at the moment. Try again later.');
  const files = new Map(input.map(file => [file.path, file.data]));
  const title = applyDetails(files, details);
  const zip = await pack(files);
  await countWrite(env, connection);
  const raw = random(32), key = toUrl(toBase64(raw)), id = crypto.randomUUID();
  const data = await encrypt(await projectKey(raw), zip);
  const now = new Date().toISOString(), expiresAt = new Date(Date.now() + connection.limits.aiDays * 86_400_000).toISOString();
  const reserved = await env.SHARES_DB.prepare(`INSERT INTO shares (id, owner_id, status, created_at, expires_at, size_bytes) SELECT ?1, ?2, 'revoked', ?3, ?4, ?5
    WHERE (SELECT COALESCE(SUM(size_bytes), 0) FROM shares WHERE expires_at > ?3) + ?5 <= ?6
      AND (SELECT COALESCE(SUM(size_bytes), 0) FROM shares WHERE expires_at > ?3 AND owner_id = ?2) + ?5 <= ?7
      AND (SELECT COALESCE(SUM(size_bytes), 0) FROM shares JOIN ai_projects ON ai_projects.id = shares.id) + ?5 <= ?8 RETURNING id`)
    .bind(id, connection.owner.id, now, expiresAt, data.length, settings.service.totalMiB * MIB, connection.limits.storageMiB * MIB, MAX_AI_BYTES).first();
  if (!reserved) throw storageError();
  try {
    await env.SHARES_DB.prepare('INSERT INTO ai_projects (id, token_id, sealed, data, version, updated_at) VALUES (?, ?, ?, ?, 1, ?)').bind(id, connection.id, await seal(connection, { key, title }), toBase64(data), Date.now()).run();
    await env.SHARES_DB.prepare('INSERT INTO share_meta (id, parts, received) VALUES (?, 1, 1)').bind(id).run();
    await env.SHARES_DB.prepare("UPDATE shares SET status = 'active' WHERE id = ?").bind(id).run();
  } catch (error) { await removeShare(env, id, connection.owner.id).catch(() => undefined); throw error; }
  await recordAi(env, connection, data.length).catch(() => undefined);
  return { id, title, link: link(env, id, key), expiresAt, version: 1, size: zip.length };
}

async function load(env: AiEnv, connection: Connection, id: string): Promise<{ row: Row; sealed: Sealed; raw: Uint8Array; files: Map<string, Uint8Array> }> {
  const row = /^[a-f0-9-]{36}$/i.test(id) ? await env.SHARES_DB.prepare("SELECT ai_projects.id, sealed, data, version, shares.expires_at as expiresAt FROM ai_projects JOIN shares ON shares.id = ai_projects.id WHERE ai_projects.id = ? AND token_id = ? AND shares.status = 'active' AND shares.expires_at > ?").bind(id.toLowerCase(), connection.id, new Date().toISOString()).first<Row>() : null;
  if (!row) throw new AiError('There is no such project. Use list_projects to see the projects of this connection. Deleted and expired projects are gone.');
  const sealed = await unseal(connection, row.sealed);
  const raw = fromBase64(sealed.key.replace(/-/g, '+').replace(/_/g, '/') + '=');
  const zip = await decrypt(await projectKey(raw), fromBase64(row.data));
  const entries = await readZip(new Blob([zip as Uint8Array<ArrayBuffer>]));
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) files.set(entry.path, new Uint8Array(await entry.blob.arrayBuffer()));
  return { row, sealed, raw, files };
}

export type Edit = { path: string; find: string; replace: string };
export function readEdits(value: unknown): Edit[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new AiError('"edits" must be a list of at most 50 { path, find, replace }.');
  return (value as Array<Record<string, unknown>>).map(edit => {
    if (typeof edit?.path !== 'string' || typeof edit.find !== 'string' || !edit.find || typeof edit.replace !== 'string') throw new AiError('Every edit needs "path", "find" and "replace" texts.');
    return { path: edit.path, find: edit.find, replace: edit.replace };
  });
}

export async function updateProject(env: AiEnv, connection: Connection, id: string, change: { files: ProjectFile[]; edits: Edit[]; remove: string[]; details: Details }): Promise<ProjectInfo> {
  const { row, sealed, raw, files } = await load(env, connection, id);
  for (const path of change.remove) { if (path === 'index.html') throw new AiError('index.html cannot be removed.'); if (!files.delete(path)) throw new AiError(`There is no file ${path} to remove.`); }
  for (const file of change.files) files.set(file.path, file.data);
  for (const edit of change.edits) {
    const current = files.get(edit.path);
    if (!current) throw new AiError(`There is no file ${edit.path}. Use read_project to see the files.`);
    const text = decoder.decode(current), count = text.split(edit.find).length - 1;
    if (count !== 1) throw new AiError(count ? `"find" appears ${count} times in ${edit.path}. Make it longer so it appears once.` : `"find" does not appear in ${edit.path}. Read the file again and copy the text exactly.`);
    files.set(edit.path, encoder.encode(text.replace(edit.find, () => edit.replace)));
  }
  const title = applyDetails(files, change.details);
  const zip = await pack(files);
  await countWrite(env, connection);
  const settings = await readSettings(env);
  const data = await encrypt(await projectKey(raw), zip);
  const now = new Date().toISOString(), expiresAt = new Date(Date.now() + connection.limits.aiDays * 86_400_000).toISOString();
  const fits = await env.SHARES_DB.prepare(`SELECT 1 as ok WHERE (SELECT COALESCE(SUM(size_bytes), 0) FROM shares WHERE expires_at > ?1 AND id <> ?2) + ?3 <= ?4
    AND (SELECT COALESCE(SUM(size_bytes), 0) FROM shares WHERE expires_at > ?1 AND id <> ?2 AND owner_id = ?5) + ?3 <= ?6`).bind(now, row.id, data.length, settings.service.totalMiB * MIB, connection.owner.id, connection.limits.storageMiB * MIB).first();
  if (!fits) throw storageError();
  // The version check keeps two parallel changes from overwriting each other.
  const saved = await env.SHARES_DB.prepare('UPDATE ai_projects SET data = ?, sealed = ?, version = version + 1, updated_at = ? WHERE id = ? AND token_id = ? AND version = ? RETURNING version').bind(toBase64(data), await seal(connection, { key: sealed.key, title }), Date.now(), row.id, connection.id, row.version).first<{ version: number }>();
  if (!saved) throw new AiError('The project was changed at the same time. Read it again and repeat the change.');
  await env.SHARES_DB.prepare('UPDATE shares SET size_bytes = ?, expires_at = ? WHERE id = ?').bind(data.length, expiresAt, row.id).run();
  await recordAi(env, connection, 0).catch(() => undefined);
  return { id: row.id, title, link: link(env, row.id, sealed.key), expiresAt, version: saved.version, size: zip.length };
}

export async function readProject(env: AiEnv, connection: Connection, id: string, path?: string): Promise<string> {
  const { row, sealed, files } = await load(env, connection, id);
  if (path) {
    const data = files.get(path);
    if (!data) throw new AiError(`There is no file ${path}. Files: ${[...files.keys()].join(', ')}`);
    if (!TEXT.test(path)) return `${path} is a binary file with ${data.length} bytes.`;
    return decoder.decode(data);
  }
  return JSON.stringify({ project_id: row.id, title: sealed.title, version: row.version, link: link(env, row.id, sealed.key), expires: row.expiresAt, files: [...files].map(([name, data]) => ({ path: name, bytes: data.length })) }, null, 2);
}

export async function listProjects(env: AiEnv, connection: Connection): Promise<Array<{ project_id: string; title: string; link: string; version: number; updated: string; expires: string; downloads: number }>> {
  const rows = await env.SHARES_DB.prepare("SELECT ai_projects.id, sealed, version, updated_at as updatedAt, shares.expires_at as expiresAt, COALESCE(share_meta.downloads, 0) as downloads FROM ai_projects JOIN shares ON shares.id = ai_projects.id LEFT JOIN share_meta ON share_meta.id = ai_projects.id WHERE token_id = ? AND shares.status = 'active' AND shares.expires_at > ? ORDER BY updated_at DESC LIMIT 50").bind(connection.id, new Date().toISOString()).all<{ id: string; sealed: string; version: number; updatedAt: number; expiresAt: string; downloads: number }>();
  return Promise.all(rows.results.map(async row => { const sealed = await unseal(connection, row.sealed); return { project_id: row.id, title: sealed.title, link: link(env, row.id, sealed.key), version: row.version, updated: new Date(row.updatedAt).toISOString(), expires: row.expiresAt, downloads: row.downloads }; }));
}

export async function deleteProject(env: AiEnv, connection: Connection, id: string): Promise<void> {
  const row = await env.SHARES_DB.prepare('SELECT id FROM ai_projects WHERE id = ? AND token_id = ?').bind(id.toLowerCase(), connection.id).first<{ id: string }>();
  if (!row) throw new AiError('There is no such project in this connection.');
  await removeShare(env, row.id, connection.owner.id);
}

/** The encrypted project for a share link, or null when the share is not an AI project. */
export async function projectBlob(env: StoreEnv, id: string): Promise<Uint8Array | null> {
  const row = await env.SHARES_DB.prepare('SELECT data FROM ai_projects WHERE id = ?').bind(id).first<{ data: string }>();
  return row ? fromBase64(row.data) : null;
}
