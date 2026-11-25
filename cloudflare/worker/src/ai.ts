/* Projects that an AI creates over MCP, and the connections (tokens) that allow it.

   Nothing readable is stored. A project is a ZIP, encrypted exactly like a share from the browser, so the
   normal share link opens it. Its key and title are stored only encrypted with a key that is derived from the
   token. The database knows the hash of a token, so without the token itself it cannot read them. */
import { createStoredZip, normalizePackagePath, readOwnZip } from '../../../src/services/zip.ts';
import { checkProject } from './guide.ts';
import { dropVersion, fromBase64, indexBlob, KV_STORE, MAX_BLOB_BYTES, putBlob, putLarge, readBlob, removeBlob, toBase64 } from './blobs.ts';
import { dayStart, hourStart, KV_USED, limitsFor, MAX_KV_BYTES, MIB, readSettings, recordAi, removeShare, type Limits, type Owner, type StoreEnv } from './service.ts';

export interface AiEnv extends StoreEnv { APP_URL?: string; ADMIN_EMAILS?: string }
export type Connection = { id: string; owner: Owner; key: CryptoKey; limits: Limits };
export type ProjectFile = { path: string; data: Uint8Array };

/** A project may be this large. The free plan gives little computing time per request, so one request may carry less (see mcp.ts). */
export const MAX_PROJECT_MIB = 10;
export const MAX_PROJECT_BYTES = MAX_PROJECT_MIB * MIB;
export const MAX_FILES = 300;
/** Projects over 1 MiB are written to KV, which allows 1,000 writes a day for the whole service. */
const MAX_LARGE_PER_DAY = 300;
const MAX_CONNECTIONS = 5;
export const MAX_CALLS_PER_HOUR = 1000;
const TYPES = ['game', 'learning', 'app', 'tool', 'simulation', 'presentation', 'quiz', 'other'];
const encoder = new TextEncoder(), decoder = new TextDecoder();

/** An error whose text is meant for the AI. */
export class AiError extends Error {}
/** Why a known connection may not be used right now. */
export type Refusal = { message: string; status: 403 | 429 };

/* ---------- Encoding and keys ---------- */

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

/** Null: unknown token. */
export async function connect(env: AiEnv, token: string, isAdmin: (email: string) => boolean): Promise<Connection | Refusal | null> {
  if (!/^ld_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await env.SHARES_DB.prepare('SELECT ai_tokens.id, ai_tokens.owner_id as ownerId, accounts.email, accounts.name, accounts.provider FROM ai_tokens JOIN accounts ON accounts.owner_id = ai_tokens.owner_id WHERE ai_tokens.hash = ?').bind(await hash(token)).first<{ id: string; ownerId: string; email: string; name: string; provider: string }>();
  if (!row) return null;
  const owner: Owner = { id: row.ownerId, email: row.email, name: row.name, picture: '', provider: row.provider, admin: row.provider === 'google.com' && isAdmin(row.email) };
  const settings = await readSettings(env);
  if (!settings.service.ai && !owner.admin) return { status: 403, message: 'AI connections are switched off by the operator of this LocalDeck service.' };
  const { limits, blocked } = await limitsFor(env, owner, settings);
  if (blocked) return { status: 403, message: 'This LocalDeck account is blocked.' };
  const calls = await env.SHARES_DB.prepare('INSERT INTO upload_windows (owner_id, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(owner_id, window_start) DO UPDATE SET uploads = uploads + 1 RETURNING uploads').bind(`ai-calls:${row.id}`, hourStart()).first<{ uploads: number }>();
  if ((calls?.uploads ?? 0) > MAX_CALLS_PER_HOUR) return { status: 429, message: 'Too many requests in this hour. Try again later.' };
  await env.SHARES_DB.prepare('UPDATE ai_tokens SET last_used = ?, calls = calls + 1 WHERE id = ?').bind(Date.now(), row.id).run();
  return { id: row.id, owner, limits, key: await tokenKey(token) };
}

/* ---------- Files ---------- */

/** "./index.html" and "/index.html" mean the file in the main folder. */
export function cleanPath(path: string): string {
  try { return normalizePackagePath(path.trim().replace(/^(?:\.?\/)+/, '')); } catch { throw new AiError(`Unsafe file path: ${path}. Use relative paths such as assets/logo.svg.`); }
}

type FileInput = { path?: unknown; content?: unknown; encoding?: unknown };

export function readFiles(value: unknown): ProjectFile[] {
  if (value === undefined) return [];
  // { "index.html": "…" } is clear enough.
  if (value && typeof value === 'object' && !Array.isArray(value)) value = Object.entries(value).map(([path, content]) => ({ path, content }));
  if (!Array.isArray(value)) throw new AiError('"files" must be a list of { path, content }.');
  return (value as FileInput[]).map(file => {
    if (typeof file?.path !== 'string' || typeof file.content !== 'string') throw new AiError('Every file needs a "path" and a "content" text.');
    let path: string;
    path = cleanPath(file.path);
    if (path.length > 200) throw new AiError(`The path is too long: ${path.slice(0, 60)}…`);
    if (file.encoding === undefined || /^(utf-?8|text)$/i.test(String(file.encoding))) return { path, data: encoder.encode(file.content) };
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
    details.tags = (input.tags as string[]).slice(0, 10).map(tag => tag.replace(/^[\s#]+/, '').trim().slice(0, 40)).filter(Boolean);
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

/** Checksums of files that did not change since they were stored. */
const checksums = new WeakMap<Uint8Array, number>();
const tooLarge = (bytes: number) => new AiError(`The project is ${(bytes / MIB).toFixed(2)} MiB. The limit is ${MAX_PROJECT_MIB} MiB. Use SVG or smaller images.`);

async function pack(files: Map<string, Uint8Array>): Promise<Uint8Array> {
  if (!files.has('index.html')) throw new AiError('The project needs an index.html.');
  if (files.size > MAX_FILES) throw new AiError(`A project can have at most ${MAX_FILES} files.`);
  const seen = new Set<string>();
  for (const path of files.keys()) { const lower = path.toLowerCase(); if (seen.has(lower)) throw new AiError(`Two files have the same name: ${path}`); seen.add(lower); }
  const bytes = [...files.values()].reduce((sum, data) => sum + data.length, 0);
  if (bytes > MAX_PROJECT_BYTES) throw tooLarge(bytes);
  const zip = new Uint8Array(await createStoredZip([...files].map(([path, data]) => ({ path, data, crc: checksums.get(data) }))).arrayBuffer());
  if (zip.length > MAX_PROJECT_BYTES) throw tooLarge(zip.length);
  return zip;
}

/* ---------- Projects ---------- */

type Sealed = { key: string; title: string };
type Row = { id: string; sealed: string; version: number; expiresAt: string };
export type ProjectInfo = { id: string; title: string; link: string; expiresAt: string; version: number; size: number; problems: string[] };

const link = (env: AiEnv, id: string, key: string) => `${env.APP_URL}#/shared/${id}?k=${key}`;

async function unseal(connection: Connection, text: string): Promise<Sealed> {
  return JSON.parse(decoder.decode(await decrypt(connection.key, fromBase64(text)))) as Sealed;
}
const seal = async (connection: Connection, value: Sealed) => toBase64(await encrypt(connection.key, encoder.encode(JSON.stringify(value))));

async function countWrite(env: AiEnv, connection: Connection): Promise<void> {
  const used = await env.SHARES_DB.prepare('INSERT INTO daily_upload_windows (owner_id, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(owner_id, window_start) DO UPDATE SET uploads = uploads + 1 RETURNING uploads').bind(`ai:${connection.owner.id}`, dayStart()).first<{ uploads: number }>();
  if ((used?.uploads ?? 0) > connection.limits.aiPerDay) throw new AiError(`The limit of ${connection.limits.aiPerDay} AI changes per day is reached. It resets at 00:00 UTC.`);
}

/** Writes a version into the databases, or into KV when it is large. */
async function store(env: AiEnv, connection: Connection, id: string, version: number, data: Uint8Array): Promise<number> {
  if (data.length > MAX_BLOB_BYTES) {
    const used = (await env.SHARES_DB.prepare(KV_USED).bind(new Date().toISOString()).first<{ bytes: number }>())?.bytes ?? 0;
    if (used + data.length > MAX_KV_BYTES) throw storageError();
    const today = await env.SHARES_DB.prepare('INSERT INTO daily_upload_windows (owner_id, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(owner_id, window_start) DO UPDATE SET uploads = uploads + 1 RETURNING uploads').bind('ai-large', dayStart()).first<{ uploads: number }>();
    if ((today?.uploads ?? 0) > MAX_LARGE_PER_DAY) throw new AiError('No more changes to projects over 1 MiB are possible today. Make the project smaller or continue tomorrow (00:00 UTC).');
    return putLarge(env, id, version, data, connection.limits.aiDays * 86_400);
  }
  const number = await putBlob(env, id, version, data);
  if (number === null) throw storageError();
  return number;
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
      AND (SELECT COALESCE(SUM(size_bytes), 0) FROM shares WHERE expires_at > ?3 AND owner_id = ?2) + ?5 <= ?7 RETURNING id`)
    .bind(id, connection.owner.id, now, expiresAt, data.length, settings.service.totalMiB * MIB, connection.limits.storageMiB * MIB).first();
  if (!reserved) throw storageError();
  try {
    await indexBlob(env, id, await store(env, connection, id, 1, data), 1, data.length);
    await env.SHARES_DB.prepare('INSERT INTO ai_projects (id, token_id, sealed, version, updated_at) VALUES (?, ?, ?, 1, ?)').bind(id, connection.id, await seal(connection, { key, title }), Date.now()).run();
    await env.SHARES_DB.prepare('INSERT INTO share_meta (id, parts, received) VALUES (?, 1, 1)').bind(id).run();
    await env.SHARES_DB.prepare("UPDATE shares SET status = 'active' WHERE id = ?").bind(id).run();
  } catch (error) { await removeBlob(env, id).catch(() => undefined); await removeShare(env, id, connection.owner.id).catch(() => undefined); throw error; }
  await recordAi(env, connection, data.length).catch(() => undefined);
  return { id, title, link: link(env, id, key), expiresAt, version: 1, size: zip.length, problems: checkProject(files) };
}

async function load(env: AiEnv, connection: Connection, id: string): Promise<{ row: Row; store: number; sealed: Sealed; raw: Uint8Array; files: Map<string, Uint8Array> }> {
  const row = /^[a-f0-9-]{36}$/i.test(id) ? await env.SHARES_DB.prepare("SELECT ai_projects.id, sealed, version, shares.expires_at as expiresAt FROM ai_projects JOIN shares ON shares.id = ai_projects.id WHERE ai_projects.id = ? AND token_id = ? AND shares.status = 'active' AND shares.expires_at > ?").bind(id.toLowerCase(), connection.id, new Date().toISOString()).first<Row>() : null;
  if (!row) throw new AiError('There is no such project. Use list_projects to see the projects of this connection. Deleted and expired projects are gone.');
  const sealed = await unseal(connection, row.sealed);
  const raw = fromBase64(sealed.key.replace(/-/g, '+').replace(/_/g, '/') + '=');
  const blob = await readBlob(env, row.id);
  if (!blob || blob === 'missing' || blob.version !== row.version) throw new AiError('The project could not be loaded right now. Try again in a moment.');
  const zip = await decrypt(await projectKey(raw), blob.bytes);
  // The encryption already proves that the archive is unchanged.
  const files = new Map<string, Uint8Array>();
  for (const entry of readOwnZip(zip)) { files.set(entry.path, entry.data); checksums.set(entry.data, entry.crc); }
  return { row, store: blob.store, sealed, raw, files };
}

export type Edit = { path: string; find: string; replace: string; all: boolean };
export function readEdits(value: unknown): Edit[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new AiError('"edits" must be a list of at most 50 { path, find, replace }.');
  return (value as Array<Record<string, unknown>>).map(edit => {
    if (typeof edit?.path !== 'string' || typeof edit.find !== 'string' || !edit.find || typeof edit.replace !== 'string') throw new AiError('Every edit needs "path", "find" and "replace" texts.');
    return { path: cleanPath(edit.path), find: edit.find, replace: edit.replace, all: edit.all === true };
  });
}

/** Returns the new version number, or null when someone else changed the project first. */
async function saveVersion(env: AiEnv, connection: Connection, row: Row, next: { data: Uint8Array; sealed: string }, oldStore: number): Promise<number | null> {
  // Claim the number first: only one of two parallel changes gets it, so they cannot overwrite each other's data.
  const claimed = await env.SHARES_DB.prepare('UPDATE ai_projects SET claim = ? WHERE id = ? AND token_id = ? AND version = ? AND (claim IS NULL OR claim < ?) RETURNING id').bind(Date.now(), row.id, connection.id, row.version, Date.now() - 30_000).first();
  if (!claimed) return null;
  const version = row.version + 1;
  let number: number;
  try { number = await store(env, connection, row.id, version, next.data); }
  catch (error) { await env.SHARES_DB.prepare('UPDATE ai_projects SET claim = NULL WHERE id = ?').bind(row.id).run(); throw error; }
  // Both together or not at all, so index and project never disagree about the version.
  await env.SHARES_DB.batch([
    env.SHARES_DB.prepare('UPDATE blob_index SET store = ?, version = ?, bytes = ? WHERE id = ?').bind(number, version, next.data.length, row.id),
    env.SHARES_DB.prepare('UPDATE ai_projects SET sealed = ?, version = ?, updated_at = ?, claim = NULL WHERE id = ?').bind(next.sealed, version, Date.now(), row.id),
  ]);
  await dropVersion(env, oldStore, row.id, row.version);
  // Moved out of KV: the databases are at once the same everywhere, so nothing has to stay for latecomers.
  if (oldStore === KV_STORE && number !== KV_STORE) await dropVersion(env, KV_STORE, row.id, version);
  return version;
}

const MAX_REPLACEMENTS = 5000;
/** Counts up to `max`. */
function occurrences(text: string, find: string, max: number): number {
  let count = 0;
  for (let at = text.indexOf(find); at >= 0 && count < max; at = text.indexOf(find, at + find.length)) count++;
  return count;
}

export async function updateProject(env: AiEnv, connection: Connection, id: string, change: { files: ProjectFile[]; edits: Edit[]; remove: string[]; details: Details }): Promise<ProjectInfo> {
  const { row, store: oldStore, sealed, raw, files } = await load(env, connection, id);
  for (const path of change.remove.map(cleanPath)) { if (path === 'index.html') throw new AiError('index.html cannot be removed.'); if (!files.delete(path)) throw new AiError(`There is no file ${path} to remove.`); }
  for (const file of change.files) files.set(file.path, file.data);
  for (const edit of change.edits) {
    const current = files.get(edit.path);
    if (!current) throw new AiError(`There is no file ${edit.path}. Use read_project to see the files.`);
    const text = decoder.decode(current);
    // An AI sees and writes plain line ends, the file may have the ones of Windows.
    const windows = !text.includes(edit.find) && text.includes('\r\n');
    const find = windows ? edit.find.replace(/\r?\n/g, '\r\n') : edit.find, replace = windows ? edit.replace.replace(/\r?\n/g, '\r\n') : edit.replace;
    const count = occurrences(text, find, edit.all ? MAX_REPLACEMENTS + 1 : 100);
    if (!count) throw new AiError(`"find" does not appear in ${edit.path}. Read the file again and copy the text exactly.`);
    if (count > 1 && !edit.all) throw new AiError(`"find" appears ${count === 100 ? 'at least 100' : count} times in ${edit.path}. Make it longer so it appears once, or set "all": true to replace every one.`);
    if (count > MAX_REPLACEMENTS) throw new AiError(`"find" appears more than ${MAX_REPLACEMENTS} times in ${edit.path}. Send the whole file instead.`);
    // Before the text is built: a short "find" and a long "replace" could become larger than the memory.
    const length = text.length + count * (replace.length - find.length);
    if (length > MAX_PROJECT_BYTES) throw tooLarge(length);
    files.set(edit.path, encoder.encode(text.split(find).join(replace)));
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
  // The new version is written next to the old one, which stays readable until the index points to the new one.
  const saved = await saveVersion(env, connection, row, { data, sealed: await seal(connection, { key: sealed.key, title }) }, oldStore);
  if (!saved) throw new AiError('The project was changed at the same time. Read it again and repeat the change.');
  await env.SHARES_DB.prepare('UPDATE shares SET size_bytes = ?, expires_at = ? WHERE id = ?').bind(data.length, expiresAt, row.id).run();
  await recordAi(env, connection, 0).catch(() => undefined);
  return { id: row.id, title, link: link(env, row.id, sealed.key), expiresAt, version: saved, size: zip.length, problems: checkProject(files) };
}

/** More than this would fill the memory of the AI with one file. */
const READ_CHARS = 100_000;

export async function readProject(env: AiEnv, connection: Connection, id: string, path?: string, offset = 0): Promise<string> {
  const { row, sealed, files } = await load(env, connection, id);
  if (path) {
    path = cleanPath(path);
    const data = files.get(path);
    if (!data) throw new AiError(`There is no file ${path}. Files: ${[...files.keys()].join(', ')}`);
    if (!TEXT.test(path)) return `${path} is a binary file with ${data.length} bytes.`;
    const text = decoder.decode(data);
    if (text.length <= READ_CHARS && !offset) return text;
    const end = Math.min(text.length, offset + READ_CHARS);
    return `${text.slice(offset, end)}${end < text.length ? `\n\n[Characters ${offset} to ${end} of ${text.length}. Call read_project again with offset ${end} for the rest.]` : ''}`;
  }
  let details: Record<string, unknown> = {};
  try { const { type, subject, topic, description, tags, language } = JSON.parse(decoder.decode(files.get(MANIFEST))) as Details; details = { type, subject, topic, description, tags, language }; } catch { /* broken manifest: the list of files is still useful */ }
  return JSON.stringify({ project_id: row.id, title: sealed.title, ...details, version: row.version, link: link(env, row.id, sealed.key), expires: row.expiresAt, files: [...files].map(([name, data]) => ({ path: name, bytes: data.length })) }, null, 2);
}

export async function checkStored(env: AiEnv, connection: Connection, id: string): Promise<string[]> {
  return checkProject((await load(env, connection, id)).files);
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

