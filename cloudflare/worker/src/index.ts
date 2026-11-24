import { sendVerificationLink, type MailEnv } from './verificationMail.ts';

interface Env extends MailEnv {
  /** Comma-separated Google addresses with admin rights. Stored as a Worker secret, never in the repository. */
  ADMIN_EMAILS?: string;
  SHARES_KV: KVNamespace;
  SHARES_DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  FIREBASE_PROJECT_ID?: string;
  ALLOWED_ORIGIN: string;
}

type GoogleClaims = { sub: string; aud: string | string[]; azp?: string; iss: string; exp: number; iat: number; nbf?: number; email: string; email_verified: boolean; name?: string; picture?: string };
type GoogleJwk = JsonWebKey & { kid: string };
type FirebaseClaims = { sub: string; aud: string; iss: string; exp: number; iat: number; auth_time?: number; email?: string; email_verified?: boolean; name?: string; picture?: string; firebase?: { sign_in_provider?: string } };
type Owner = { id: string; email: string; name: string; picture: string; admin: boolean };
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const idPattern = /^[a-f0-9-]{36}$/i;
const encoder = new TextEncoder();
const MAX_SHARE_BYTES = 24 * 1024 * 1024;
const MAX_ACTIVE_BYTES = 512 * 1024 * 1024;
const MAX_USER_BYTES = 48 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
const MAX_USER_UPLOADS_PER_HOUR = 5;
const MAX_USER_UPLOADS_PER_DAY = 15;
const MAX_GLOBAL_UPLOADS_PER_DAY = 100;
const MAX_IP_READS_PER_HOUR = 120;
const MAX_IP_AUTH_PER_HOUR = 120;
const MAX_IP_MAILS_PER_HOUR = 8;
const MAX_MAILS_PER_DAY = 90;
const MAIL_WAIT_MS = 120_000;
const SHARE_TTL_SECONDS = 3 * 24 * 60 * 60;
let googleKeys: { keys: GoogleJwk[]; expiresAt: number } | null = null;
let firebaseKeys: { keys: GoogleJwk[]; expiresAt: number } | null = null;

/** ALLOWED_ORIGIN may list several origins separated by commas (e.g. the Pages site and local dev). */
function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGIN || '').split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
}

function cors(request: Request, env: Env): Headers {
  const origin = request.headers.get('Origin');
  const headers = new Headers({ 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400', vary: 'Origin' });
  if (origin && allowedOrigins(env).includes(origin)) headers.set('access-control-allow-origin', origin);
  return headers;
}

function response(body: BodyInit | null, status: number, corsHeaders: Headers, extra?: HeadersInit): Response {
  const headers = new Headers(corsHeaders);
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(body, { status, headers });
}

function json(data: unknown, status: number, headers: Headers): Response { return response(JSON.stringify(data), status, headers, jsonHeaders); }

function b64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

function decodeJson<T>(segment: string): T { return JSON.parse(new TextDecoder().decode(b64url(segment))) as T; }

async function readBounded(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  if (!request.body) throw new Error('empty_body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output.buffer;
}

async function clientHash(request: Request, scope = ''): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(scope + ip)))).map(value => value.toString(16).padStart(2, '0')).join('');
}

async function rateLimitIp(env: Env, request: Request, table: 'auth_windows' | 'read_windows', limit: number, scope = ''): Promise<boolean> {
  const hash = await clientHash(request, scope);
  const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const column = table === 'auth_windows' ? 'attempts' : 'reads';
  await env.SHARES_DB.prepare(`INSERT INTO ${table} (client_hash, window_start, ${column}) VALUES (?, ?, 1) ON CONFLICT(client_hash, window_start) DO UPDATE SET ${column} = ${column} + 1`).bind(hash, windowStart).run();
  const row = await env.SHARES_DB.prepare(`SELECT ${column} as count FROM ${table} WHERE client_hash = ? AND window_start = ?`).bind(hash, windowStart).first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
}

async function getGoogleKeys(fresh = false): Promise<GoogleJwk[]> {
  if (!fresh && googleKeys && googleKeys.expiresAt > Date.now()) return googleKeys.keys;
  const result = await fetch('https://www.googleapis.com/oauth2/v3/certs', fresh ? { cf: { cacheTtl: 0 } } : { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!result.ok) throw new Error('Google signing keys are temporarily unavailable.');
  const data = await result.json() as { keys: GoogleJwk[] };
  if (!Array.isArray(data.keys)) throw new Error('Google signing keys are invalid.');
  const cacheControl = result.headers.get('cache-control') ?? '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] ?? 3600);
  googleKeys = { keys: data.keys, expiresAt: Date.now() + Math.min(maxAge, 3600) * 1000 };
  return data.keys;
}

async function verifyGoogleCredential(token: string, env: Env): Promise<Owner | null> {
  if (!env.GOOGLE_CLIENT_ID || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
    const claims = decodeJson<GoogleClaims>(parts[1]);
    if (header.alg !== 'RS256' || !header.kid || !claims.sub || !claims.email || claims.email_verified !== true) return null;
    if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return null;
    if (claims.aud !== env.GOOGLE_CLIENT_ID && !(Array.isArray(claims.aud) && claims.aud.includes(env.GOOGLE_CLIENT_ID) && claims.azp === env.GOOGLE_CLIENT_ID)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 300 || claims.iat < now - 7200 || (claims.nbf !== undefined && claims.nbf > now + 300)) return null;
    // Google replaces its keys regularly. Look again before refusing, so the first sign-in after a change works.
    const jwk = (await getGoogleKeys()).find(key => key.kid === header.kid) ?? (await getGoogleKeys(true)).find(key => key.kid === header.kid);
    if (!jwk) return null;
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const rawSignature = b64url(parts[2]);
    const signature = new Uint8Array(rawSignature.byteLength);
    signature.set(rawSignature);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    return { id: claims.sub, email: claims.email.slice(0, 320), name: (claims.name || claims.email).slice(0, 120), picture: (claims.picture || '').slice(0, 1000), admin: isAdminEmail(claims.email, env) };
  } catch { return null; }
}

async function getFirebaseKeys(fresh = false): Promise<GoogleJwk[]> {
  if (!fresh && firebaseKeys && firebaseKeys.expiresAt > Date.now()) return firebaseKeys.keys;
  const result = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', fresh ? { cf: { cacheTtl: 0 } } : { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!result.ok) throw new Error('Firebase signing keys are temporarily unavailable.');
  const data = await result.json() as { keys: GoogleJwk[] };
  if (!Array.isArray(data.keys)) throw new Error('Firebase signing keys are invalid.');
  const cacheControl = result.headers.get('cache-control') ?? '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] ?? 3600);
  firebaseKeys = { keys: data.keys, expiresAt: Date.now() + Math.min(maxAge, 3600) * 1000 };
  return data.keys;
}

/** Admins are named by their Google address. Other sign-in methods never grant admin rights. */
function isAdminEmail(email: string, env: Env): boolean {
  return (env.ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
}

/** Checks signature, project and lifetime. Does not require a confirmed email address. */
async function verifyFirebaseToken(token: string, env: Env): Promise<(FirebaseClaims & { email: string }) | null> {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
    const claims = decodeJson<FirebaseClaims>(parts[1]);
    if (header.alg !== 'RS256' || !header.kid || !claims.sub || claims.sub.length > 128 || !claims.email) return null;
    if (claims.iss !== `https://securetoken.google.com/${projectId}` || claims.aud !== projectId) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 300 || claims.iat < now - 3600 || (claims.auth_time !== undefined && (!Number.isFinite(claims.auth_time) || claims.auth_time > now + 300))) return null;
    const jwk = (await getFirebaseKeys()).find(key => key.kid === header.kid) ?? (await getFirebaseKeys(true)).find(key => key.kid === header.kid);
    if (!jwk) return null;
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const rawSignature = b64url(parts[2]);
    const signature = new Uint8Array(rawSignature.byteLength); signature.set(rawSignature);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    return { ...claims, email: claims.email };
  } catch { return null; }
}

async function verifyFirebaseCredential(token: string, env: Env): Promise<Owner | null> {
  const claims = await verifyFirebaseToken(token, env);
  if (!claims || claims.email_verified !== true) return null;
  const admin = claims.firebase?.sign_in_provider === 'google.com' && isAdminEmail(claims.email, env);
  return { id: `firebase:${claims.sub}`, email: claims.email.slice(0, 320), name: (claims.name || claims.email).slice(0, 120), picture: (claims.picture || '').slice(0, 1000), admin };
}

/** Kept apart from "not signed in", so the app does not ask people to sign in again when they only have to wait. */
class RateLimited extends Error {}

async function isAuthorized(request: Request, env: Env): Promise<Owner | null> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token || token.length > 8192) return null;
  if (!await rateLimitIp(env, request, 'auth_windows', MAX_IP_AUTH_PER_HOUR)) throw new RateLimited();
  try {
    const claims = decodeJson<{ iss?: string }>(token.split('.')[1] ?? '');
    return claims.iss === `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}` ? verifyFirebaseCredential(token, env) : verifyGoogleCredential(token, env);
  } catch { return null; }
}

async function releaseQuota(env: Env, ownerId: string, size: number, releaseSlot = false): Promise<void> {
  if (size > 0) {
    await env.SHARES_DB.prepare('UPDATE storage_state SET reserved_bytes = MAX(0, reserved_bytes - ?) WHERE id = 1').bind(size).run();
    await env.SHARES_DB.prepare('UPDATE user_storage SET active_bytes = MAX(0, active_bytes - ?) WHERE owner_id = ?').bind(size, ownerId).run();
  }
  if (releaseSlot) {
    await env.SHARES_DB.prepare('UPDATE storage_state SET active_uploads = MAX(0, active_uploads - 1) WHERE id = 1').run();
    await env.SHARES_DB.prepare('UPDATE user_storage SET active_uploads = MAX(0, active_uploads - 1) WHERE owner_id = ?').bind(ownerId).run();
  }
}

async function cleanupExpired(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const rows = await env.SHARES_DB.prepare('SELECT id, owner_id, size_bytes FROM shares WHERE expires_at <= ? LIMIT 100').bind(now).all<{ id: string; owner_id: string; size_bytes: number }>();
  for (const row of rows.results) {
    const removed = await env.SHARES_DB.prepare('DELETE FROM shares WHERE id = ? AND expires_at <= ? RETURNING owner_id, size_bytes').bind(row.id, now).first<{ owner_id: string; size_bytes: number }>();
    if (!removed) continue;
    await env.SHARES_KV.delete(row.id).catch(() => undefined);
    await releaseQuota(env, removed.owner_id, removed.size_bytes);
  }
  const old = Date.now() - 48 * 3_600_000;
  await env.SHARES_DB.prepare('DELETE FROM upload_windows WHERE window_start < ?').bind(old).run();
  await env.SHARES_DB.prepare('DELETE FROM auth_windows WHERE window_start < ?').bind(old).run();
  await env.SHARES_DB.prepare('DELETE FROM read_windows WHERE window_start < ?').bind(old).run();
  await env.SHARES_DB.prepare('DELETE FROM daily_upload_windows WHERE window_start < ?').bind(Date.now() - 8 * 86_400_000).run();
  await env.SHARES_DB.prepare('DELETE FROM global_upload_windows WHERE window_start < ?').bind(Date.now() - 8 * 86_400_000).run();
  await env.SHARES_DB.prepare('DELETE FROM verification_mails WHERE sent_at < ?').bind(old).run();
  await env.SHARES_DB.prepare('DELETE FROM mail_windows WHERE window_start < ?').bind(Date.now() - 8 * 86_400_000).run();
  await env.SHARES_DB.prepare('DELETE FROM user_storage WHERE active_bytes = 0 AND active_uploads = 0 AND NOT EXISTS (SELECT 1 FROM shares WHERE shares.owner_id = user_storage.owner_id)').run();
}

/* The D1 schema (mirrors cloudflare/schema.sql). Applied once per isolate so a fresh or never-migrated
   database cannot make every request fail. All statements are idempotent. */
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS shares ( id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN (\'active\', \'revoked\')) DEFAULT \'active\', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK (size_bytes > 0) )',
  'CREATE INDEX IF NOT EXISTS shares_expiration_idx ON shares(expires_at)',
  'CREATE INDEX IF NOT EXISTS shares_owner_idx ON shares(owner_id, created_at DESC)',
  'CREATE TABLE IF NOT EXISTS upload_windows ( owner_id TEXT NOT NULL, window_start INTEGER NOT NULL, uploads INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner_id, window_start) )',
  'CREATE TABLE IF NOT EXISTS daily_upload_windows ( owner_id TEXT NOT NULL, window_start INTEGER NOT NULL, uploads INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner_id, window_start) )',
  'CREATE TABLE IF NOT EXISTS global_upload_windows ( window_start INTEGER PRIMARY KEY, uploads INTEGER NOT NULL DEFAULT 0 )',
  'CREATE TABLE IF NOT EXISTS auth_windows ( client_hash TEXT NOT NULL, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (client_hash, window_start) )',
  'CREATE TABLE IF NOT EXISTS read_windows ( client_hash TEXT NOT NULL, window_start INTEGER NOT NULL, reads INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (client_hash, window_start) )',
  'CREATE TABLE IF NOT EXISTS user_storage ( owner_id TEXT PRIMARY KEY, active_bytes INTEGER NOT NULL DEFAULT 0 CHECK (active_bytes >= 0 AND active_bytes <= 50331648), active_uploads INTEGER NOT NULL DEFAULT 0 CHECK (active_uploads >= 0 AND active_uploads <= 3) )',
  'CREATE TABLE IF NOT EXISTS storage_state ( id INTEGER PRIMARY KEY CHECK (id = 1), reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0 AND reserved_bytes <= 536870912), active_uploads INTEGER NOT NULL DEFAULT 0 CHECK (active_uploads >= 0 AND active_uploads <= 3) )',
  'CREATE TABLE IF NOT EXISTS verification_mails ( owner_id TEXT PRIMARY KEY, sent_at INTEGER NOT NULL )',
  'CREATE TABLE IF NOT EXISTS mail_windows ( window_start INTEGER PRIMARY KEY, sent INTEGER NOT NULL DEFAULT 0 )',
  'INSERT OR IGNORE INTO storage_state (id, reserved_bytes, active_uploads) VALUES (1, 0, 0)',
];
let schemaReady = false;
/** Only the finished result is shared between requests. A shared in-flight promise would belong to the
    request that started it, and Workers can fail every other request that waits on it. */
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady || !env.SHARES_DB) return;
  for (const sql of SCHEMA) await env.SHARES_DB.prepare(sql).run();
  schemaReady = true;
}

/** Totals and all active links. Contains no email addresses, and contents stay encrypted. */
async function adminOverview(env: Env, owner: Owner): Promise<unknown> {
  const now = new Date().toISOString();
  const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  const totals = await env.SHARES_DB.prepare("SELECT COUNT(*) as links, COUNT(DISTINCT owner_id) as owners, COALESCE(SUM(size_bytes), 0) as bytes FROM shares WHERE status = 'active' AND expires_at > ?").bind(now).first<{ links: number; owners: number; bytes: number }>();
  const uploads = await env.SHARES_DB.prepare('SELECT uploads FROM global_upload_windows WHERE window_start = ?').bind(dayStart).first<{ uploads: number }>();
  const rows = await env.SHARES_DB.prepare("SELECT id, owner_id as ownerId, created_at as createdAt, expires_at as expiresAt, size_bytes as sizeBytes FROM shares WHERE status = 'active' AND expires_at > ? ORDER BY created_at DESC LIMIT 200").bind(now).all<{ id: string; ownerId: string; createdAt: string; expiresAt: string; sizeBytes: number }>();
  return {
    totals: { links: totals?.links ?? 0, owners: totals?.owners ?? 0, bytes: totals?.bytes ?? 0, limitBytes: MAX_ACTIVE_BYTES, uploadsToday: uploads?.uploads ?? 0, uploadsLimit: MAX_GLOBAL_UPLOADS_PER_DAY },
    shares: rows.results.map(({ ownerId, ...row }) => ({ ...row, owner: ownerId.replace(/^firebase:/, '').slice(0, 6), mine: ownerId === owner.id })),
  };
}

/** Sends the LocalDeck confirmation email to the address inside a valid Firebase token, never to one the client names. */
async function sendVerification(request: Request, env: Env, headers: Headers): Promise<Response> {
  if (!env.FIREBASE_SERVICE_ACCOUNT || !env.MAIL_RELAY_URL || !env.MAIL_RELAY_SECRET || !env.APP_URL) return json({ error: 'mail_not_configured' }, 501, headers);
  if (!await rateLimitIp(env, request, 'auth_windows', MAX_IP_MAILS_PER_HOUR, 'mail:')) return json({ error: 'rate_limited' }, 429, headers);
  let credential = '';
  try { const body = JSON.parse(new TextDecoder().decode(await readBounded(request, 12 * 1024))) as { credential?: unknown }; credential = typeof body.credential === 'string' ? body.credential : ''; }
  catch { return json({ error: 'invalid_request' }, 400, headers); }
  const claims = await verifyFirebaseToken(credential, env);
  if (!claims) return json({ error: 'unauthorized' }, 401, headers);
  if (claims.email_verified === true) return json({ ok: true, alreadyVerified: true }, 200, headers);

  const now = Date.now();
  const claimed = await env.SHARES_DB.prepare('INSERT INTO verification_mails (owner_id, sent_at) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET sent_at = excluded.sent_at WHERE verification_mails.sent_at <= ? RETURNING owner_id').bind(claims.sub, now, now - MAIL_WAIT_MS).first<{ owner_id: string }>();
  if (!claimed) return json({ error: 'mail_wait' }, 429, headers);
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  const slot = await env.SHARES_DB.prepare('INSERT INTO mail_windows (window_start, sent) VALUES (?, 1) ON CONFLICT(window_start) DO UPDATE SET sent = sent + 1 WHERE mail_windows.sent < ? RETURNING sent').bind(dayStart, MAX_MAILS_PER_DAY).first<{ sent: number }>();
  try {
    if (!slot) throw new Error('daily_limit');
    await sendVerificationLink(env, claims.email, claims.name ?? '');
    return json({ ok: true }, 200, headers);
  } catch (error) {
    // Frees the two-minute lock: the app falls back to Firebase's own email.
    await env.SHARES_DB.prepare('DELETE FROM verification_mails WHERE owner_id = ?').bind(claims.sub).run();
    console.error('verification_mail_failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: slot ? 'mail_failed' : 'mail_daily_limit' }, slot ? 502 : 429, headers);
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      // Existing tables keep working when this check fails, so a short database outage must not stop the request here.
      if (request.method !== 'OPTIONS') await ensureSchema(env).catch(error => console.error('schema_check_failed', error));
      if (request.method !== 'GET') return await worker.handle(request, env);
      try { return await worker.handle(request, env); }
      catch (error) {
        if (error instanceof RateLimited) throw error;
        console.error('read_retry', error);
        await new Promise(resolve => setTimeout(resolve, 150));
        return await worker.handle(request, env);
      }
    } catch (error) {
      if (error instanceof RateLimited) return json({ error: 'rate_limited' }, 429, cors(request, env));
      console.error('unhandled_request_error', error);
      return json({ error: 'service_unavailable' }, 503, cors(request, env));
    }
  },

  async handle(request: Request, env: Env): Promise<Response> {
    const headers = cors(request, env);
    const origin = request.headers.get('Origin');
    if (origin && !headers.has('access-control-allow-origin')) return json({ error: 'origin_not_allowed' }, 403, headers);
    if (request.method === 'OPTIONS') return response(null, 204, headers);
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'shares') return json({ error: 'not_found' }, 404, headers);

    if (parts[3] === 'auth' && parts[4] === 'google' && parts.length === 5 && request.method === 'POST') {
      if (!await rateLimitIp(env, request, 'auth_windows', MAX_IP_AUTH_PER_HOUR)) return json({ error: 'rate_limited' }, 429, headers);
      let credential = '';
      try { const text = new TextDecoder().decode(await readBounded(request, 12 * 1024)); const body = JSON.parse(text) as { credential?: unknown }; credential = typeof body.credential === 'string' ? body.credential : ''; }
      catch { return json({ error: 'invalid_request' }, 400, headers); }
      const owner = await verifyGoogleCredential(credential, env);
      if (!owner) return json({ error: 'unauthorized' }, 401, headers);
      return json(owner, 200, headers);
    }

    if (parts[3] === 'auth' && parts[4] === 'firebase' && parts.length === 5 && request.method === 'POST') {
      if (!await rateLimitIp(env, request, 'auth_windows', MAX_IP_AUTH_PER_HOUR)) return json({ error: 'rate_limited' }, 429, headers);
      let credential = '';
      try { const text = new TextDecoder().decode(await readBounded(request, 12 * 1024)); const body = JSON.parse(text) as { credential?: unknown }; credential = typeof body.credential === 'string' ? body.credential : ''; }
      catch { return json({ error: 'invalid_request' }, 400, headers); }
      const owner = await verifyFirebaseCredential(credential, env);
      if (!owner) return json({ error: 'unauthorized' }, 401, headers);
      return json(owner, 200, headers);
    }

    if (parts[3] === 'auth' && parts[4] === 'verification' && parts.length === 5 && request.method === 'POST') return sendVerification(request, env, headers);

    if (parts[3] === 'admin' && parts[4] === 'overview' && parts.length === 5 && request.method === 'GET') {
      const owner = await isAuthorized(request, env);
      if (!owner) return json({ error: 'unauthorized' }, 401, headers);
      if (!owner.admin) return json({ error: 'forbidden' }, 403, headers);
      return json(await adminOverview(env, owner), 200, headers);
    }

    if (parts[3] === 'owner' && parts[4] === 'shares' && parts.length === 5 && request.method === 'GET') {
      const owner = await isAuthorized(request, env);
      if (!owner) return json({ error: 'unauthorized' }, 401, headers);
      const result = await env.SHARES_DB.prepare("SELECT id, status, created_at as createdAt, expires_at as expiresAt, size_bytes as sizeBytes FROM shares WHERE owner_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 50").bind(owner.id).all<{ id: string; status: string; createdAt: string; expiresAt: string; sizeBytes: number }>();
      return json(result.results.map(row => ({ ...row, label: 'Encrypted project' })), 200, headers);
    }

    if (parts.length === 3 && request.method === 'POST') {
      const owner = await isAuthorized(request, env);
      if (!owner) return json({ error: 'unauthorized' }, 401, headers);
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (!Number.isSafeInteger(declared) || declared < 29 || declared > MAX_SHARE_BYTES) return json({ error: 'invalid_size' }, 413, headers);
      const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
      await env.SHARES_DB.prepare('INSERT INTO upload_windows (owner_id, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(owner_id, window_start) DO UPDATE SET uploads = uploads + 1').bind(owner.id, windowStart).run();
      const rate = await env.SHARES_DB.prepare('SELECT uploads FROM upload_windows WHERE owner_id = ? AND window_start = ?').bind(owner.id, windowStart).first<{ uploads: number }>();
      if (!owner.admin && (rate?.uploads ?? 0) > MAX_USER_UPLOADS_PER_HOUR) return json({ error: 'rate_limited' }, 429, headers);
      const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400_000;
      await env.SHARES_DB.prepare('INSERT INTO daily_upload_windows (owner_id, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(owner_id, window_start) DO UPDATE SET uploads = uploads + 1').bind(owner.id, dayStart).run();
      const daily = await env.SHARES_DB.prepare('SELECT uploads FROM daily_upload_windows WHERE owner_id = ? AND window_start = ?').bind(owner.id, dayStart).first<{ uploads: number }>();
      if (!owner.admin && (daily?.uploads ?? 0) > MAX_USER_UPLOADS_PER_DAY) return json({ error: 'daily_rate_limited' }, 429, headers);
      await env.SHARES_DB.prepare('INSERT INTO global_upload_windows (window_start, uploads) VALUES (?, 1) ON CONFLICT(window_start) DO UPDATE SET uploads = uploads + 1').bind(dayStart).run();
      const globalDaily = await env.SHARES_DB.prepare('SELECT uploads FROM global_upload_windows WHERE window_start = ?').bind(dayStart).first<{ uploads: number }>();
      if ((globalDaily?.uploads ?? 0) > MAX_GLOBAL_UPLOADS_PER_DAY) return json({ error: 'daily_rate_limited' }, 429, headers);
      const slot = await env.SHARES_DB.prepare('UPDATE storage_state SET reserved_bytes = reserved_bytes + ?, active_uploads = active_uploads + 1 WHERE id = 1 AND reserved_bytes + ? <= ? AND active_uploads < ? RETURNING id').bind(declared, declared, MAX_ACTIVE_BYTES, MAX_CONCURRENT_UPLOADS).first<{ id: number }>();
      if (!slot) return json({ error: 'storage_or_upload_limit' }, 429, headers);
      const userSlot = await env.SHARES_DB.prepare('INSERT INTO user_storage (owner_id, active_bytes, active_uploads) VALUES (?, ?, 1) ON CONFLICT(owner_id) DO UPDATE SET active_bytes = active_bytes + excluded.active_bytes, active_uploads = active_uploads + 1 WHERE user_storage.active_bytes + excluded.active_bytes <= ? AND user_storage.active_uploads < ? RETURNING owner_id').bind(owner.id, declared, MAX_USER_BYTES, MAX_CONCURRENT_UPLOADS).first<{ owner_id: string }>();
      if (!userSlot) {
        await env.SHARES_DB.prepare('UPDATE storage_state SET reserved_bytes = MAX(0, reserved_bytes - ?), active_uploads = MAX(0, active_uploads - 1) WHERE id = 1').bind(declared).run();
        return json({ error: 'user_storage_limit' }, 429, headers);
      }
      const shareId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SHARE_TTL_SECONDS * 1000).toISOString();
      let committed = false;
      let metadataCreated = false;
      let metadataRemoved = false;
      try {
        const encrypted = await readBounded(request, MAX_SHARE_BYTES);
        if (!encrypted.byteLength || encrypted.byteLength !== declared || encrypted.byteLength > MAX_SHARE_BYTES) return json({ error: 'invalid_size' }, 413, headers);
        await env.SHARES_DB.prepare('INSERT INTO shares (id, owner_id, status, created_at, expires_at, size_bytes) VALUES (?, ?, ?, ?, ?, ?)').bind(shareId, owner.id, 'revoked', now.toISOString(), expiresAt, encrypted.byteLength).run();
        metadataCreated = true;
        await env.SHARES_KV.put(shareId, encrypted, { expirationTtl: SHARE_TTL_SECONDS });
        const activated = await env.SHARES_DB.prepare("UPDATE shares SET status = 'active' WHERE id = ? AND owner_id = ? AND status = 'revoked' RETURNING id").bind(shareId, owner.id).first<{ id: string }>();
        if (!activated) throw new Error('share_activation_failed');
        committed = true;
        return json({ id: shareId, expiresAt }, 201, headers);
      } catch (error) {
        if (metadataCreated) {
          try {
            await env.SHARES_KV.delete(shareId);
            const removed = await env.SHARES_DB.prepare("DELETE FROM shares WHERE id = ? AND owner_id = ? AND status = 'revoked' RETURNING id").bind(shareId, owner.id).first<{ id: string }>();
            metadataRemoved = Boolean(removed);
          } catch { /* The revoked row keeps quota reserved until expiry cleanup. */ }
        }
        console.error('share_write_failed', error);
        return json({ error: 'share_write_failed' }, 500, headers);
      } finally {
        await releaseQuota(env, owner.id, committed || (metadataCreated && !metadataRemoved) ? 0 : declared, true);
      }
    }

    const id = parts[3];
    const blobRoute = parts.length === 5 && parts[4] === 'blob';
    if (!idPattern.test(id ?? '')) return json({ error: 'not_found' }, 404, headers);
    if (!await rateLimitIp(env, request, 'read_windows', MAX_IP_READS_PER_HOUR)) return json({ error: 'rate_limited' }, 429, headers);
    if (!blobRoute && request.method === 'DELETE' && parts.length === 4) {
      const owner = await isAuthorized(request, env);
      if (!owner) return json({ error: 'unauthorized' }, 401, headers);
      const revoked = await env.SHARES_DB.prepare("UPDATE shares SET status = 'revoked' WHERE id = ? AND (owner_id = ? OR ? = 1) AND status = 'active' RETURNING owner_id, size_bytes").bind(id, owner.id, owner.admin ? 1 : 0).first<{ owner_id: string; size_bytes: number }>();
      if (revoked) {
        let blobDeleted = false;
        try { await env.SHARES_KV.delete(id); blobDeleted = true; } catch { /* The revoked D1 row blocks downloads until expiry cleanup. */ }
        if (blobDeleted) {
          const removed = await env.SHARES_DB.prepare("DELETE FROM shares WHERE id = ? AND owner_id = ? AND status = 'revoked' RETURNING owner_id, size_bytes").bind(id, revoked.owner_id).first<{ owner_id: string; size_bytes: number }>();
          if (removed) await releaseQuota(env, removed.owner_id, removed.size_bytes);
        }
      }
      return revoked ? json({ id, status: 'deleted' }, 200, headers) : json({ error: 'share_unavailable' }, 404, headers);
    }
    if (request.method !== 'GET') return json({ error: 'not_found' }, 404, headers);
    const row = await env.SHARES_DB.prepare('SELECT id, status, created_at, expires_at, size_bytes FROM shares WHERE id = ?').bind(id).first<{ id: string; status: string; created_at: string; expires_at: string; size_bytes: number }>();
    if (!row || row.status !== 'active' || Date.parse(row.expires_at) <= Date.now()) return json({ error: 'share_unavailable' }, 410, headers);
    if (blobRoute) {
      const blob = await env.SHARES_KV.get(id, 'arrayBuffer');
      if (!blob) return json({ error: 'share_blob_missing' }, 404, headers);
      return response(blob, 200, headers, { 'content-type': 'application/octet-stream', 'content-length': String(blob.byteLength), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    }
    if (parts.length === 4) return json({ id: row.id, status: row.status, expiresAt: row.expires_at, sizeBytes: row.size_bytes }, 200, headers);
    return json({ error: 'not_found' }, 404, headers);
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> { context.waitUntil(ensureSchema(env).then(() => cleanupExpired(env))); },
};

export default worker;
