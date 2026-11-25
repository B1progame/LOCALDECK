import {
  changeAccount, changeSettings, cleanup, countDownload, deleteAccount, limitsFor, logShareRemoval, overview, partKey, partSize, pendingShare, readSettings,
  recordSignIn, removeAccountShares, removeShare, reserve, SCHEMA, SINGLE_BYTES, PART_BYTES, MIB, BOUNDS, storePart, usageFor, type Owner,
} from './service.ts';
import { createConnection, listConnections, removeConnection } from './ai.ts';
import { readBlob } from './blobs.ts';
import { handleMcp } from './mcp.ts';
import { sendVerificationLink, type MailEnv } from './verificationMail.ts';

interface Env extends MailEnv {
  /** Comma-separated Google addresses with admin rights. Stored as a Worker secret, never in the repository. */
  ADMIN_EMAILS?: string;
  SHARES_KV: KVNamespace;
  SHARES_DB: D1Database;
  /** More room for projects. The service also runs without them. */
  PROJECTS_DB_2?: D1Database;
  PROJECTS_DB_3?: D1Database;
  GOOGLE_CLIENT_ID: string;
  FIREBASE_PROJECT_ID?: string;
  ALLOWED_ORIGIN: string;
}

type GoogleClaims = { sub: string; aud: string | string[]; azp?: string; iss: string; exp: number; iat: number; nbf?: number; email: string; email_verified: boolean; name?: string; picture?: string };
type GoogleJwk = JsonWebKey & { kid: string };
type FirebaseClaims = { sub: string; aud: string; iss: string; exp: number; iat: number; auth_time?: number; email?: string; email_verified?: boolean; name?: string; picture?: string; firebase?: { sign_in_provider?: string } };
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const idPattern = /^[a-f0-9-]{36}$/i;
const encoder = new TextEncoder();
const MAX_IP_READS_PER_HOUR = 200;
const MAX_IP_AUTH_PER_HOUR = 240;
const MAX_IP_MAILS_PER_HOUR = 8;
const MAX_MAILS_PER_DAY = 90;
const MAIL_WAIT_MS = 120_000;
let googleKeys: { keys: GoogleJwk[]; expiresAt: number } | null = null;
let firebaseKeys: { keys: GoogleJwk[]; expiresAt: number } | null = null;

/** ALLOWED_ORIGIN may list several origins separated by commas (e.g. the Pages site and local dev). */
function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGIN || '').split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
}

function cors(request: Request, env: Env): Headers {
  const origin = request.headers.get('Origin');
  const headers = new Headers({ 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-share-size, x-share-parts', 'access-control-max-age': '86400', vary: 'Origin' });
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
    return { id: claims.sub, email: claims.email.slice(0, 320), name: (claims.name || claims.email).slice(0, 120), picture: (claims.picture || '').slice(0, 1000), provider: 'google.com', admin: isAdminEmail(claims.email, env) };
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
  return { id: `firebase:${claims.sub}`, email: claims.email.slice(0, 320), name: (claims.name || claims.email).slice(0, 120), picture: (claims.picture || '').slice(0, 1000), provider: (claims.firebase?.sign_in_provider ?? 'firebase').slice(0, 40), admin };
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

const SCHEMA_VERSION = '5';
let schemaReady = false;
/** Only the finished result is shared between requests. A shared in-flight promise would belong to the
    request that started it, and Workers can fail every other request that waits on it.
    One query is enough once the tables exist: the free plan allows 50 queries per request. */
async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady || !env.SHARES_DB) return;
  const known = await env.SHARES_DB.prepare("SELECT value FROM service_settings WHERE id = 'schema'").first<{ value: string }>().catch(() => null);
  if (known?.value !== SCHEMA_VERSION) {
    for (const sql of SCHEMA) await env.SHARES_DB.prepare(sql).run();
    await env.SHARES_DB.prepare("INSERT INTO service_settings (id, value) VALUES ('schema', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value").bind(SCHEMA_VERSION).run();
  }
  schemaReady = true;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const value = JSON.parse(new TextDecoder().decode(await readBounded(request, 12 * 1024))) as unknown;
  if (!value || typeof value !== 'object') throw new Error('invalid_request');
  return value as Record<string, unknown>;
}

async function signIn(request: Request, env: Env, headers: Headers, verify: (token: string, env: Env) => Promise<Owner | null>): Promise<Response> {
  if (!await rateLimitIp(env, request, 'auth_windows', MAX_IP_AUTH_PER_HOUR)) return json({ error: 'rate_limited' }, 429, headers);
  let credential = '';
  try { const body = await readJson(request); credential = typeof body.credential === 'string' ? body.credential : ''; }
  catch { return json({ error: 'invalid_request' }, 400, headers); }
  const owner = await verify(credential, env);
  if (!owner) return json({ error: 'unauthorized' }, 401, headers);
  // The statistics must never keep someone from signing in.
  const allowed = await recordSignIn(env, owner).catch(error => { console.error('sign_in_not_recorded', error); return true; });
  return allowed ? json(owner, 200, headers) : json({ error: 'blocked' }, 403, headers);
}

async function admin(request: Request, env: Env, headers: Headers, parts: string[]): Promise<Response> {
  const owner = await isAuthorized(request, env);
  if (!owner) return json({ error: 'unauthorized' }, 401, headers);
  if (!owner.admin) return json({ error: 'forbidden' }, 403, headers);
  const [area, rawId, action] = parts;
  if (area === 'overview' && parts.length === 1 && request.method === 'GET') return json(await overview(env, owner), 200, headers);
  let body: Record<string, unknown> = {};
  if (request.method === 'PUT') try { body = await readJson(request); } catch { return json({ error: 'invalid_request' }, 400, headers); }
  if (area === 'limits' && parts.length === 1 && request.method === 'PUT') return json(await changeSettings(env, owner, body), 200, headers);
  if (area === 'accounts' && rawId) {
    let id = '';
    try { id = decodeURIComponent(rawId); } catch { return json({ error: 'not_found' }, 404, headers); }
    if (parts.length === 2 && request.method === 'PUT') return await changeAccount(env, owner, id, body) ? json({ ok: true }, 200, headers) : json({ error: 'not_changed' }, 409, headers);
    if (parts.length === 3 && action === 'shares' && request.method === 'DELETE') return json({ removed: await removeAccountShares(env, owner, id) }, 200, headers);
  }
  return json({ error: 'not_found' }, 404, headers);
}

/** The AI connections of an account. */
async function aiConnections(request: Request, env: Env, headers: Headers, parts: string[]): Promise<Response> {
  const owner = await isAuthorized(request, env);
  if (!owner) return json({ error: 'unauthorized' }, 401, headers);
  const settings = await readSettings(env);
  const { limits, blocked } = await limitsFor(env, owner, settings);
  if (blocked) return json({ error: 'blocked' }, 403, headers);
  const enabled = settings.service.ai || owner.admin;
  if (parts.length === 0 && request.method === 'GET') return json({ enabled, limits, connections: await listConnections(env, owner) }, 200, headers);
  if (parts.length === 1 && request.method === 'DELETE') return await removeConnection(env, owner, parts[0]!) ? json({ ok: true }, 200, headers) : json({ error: 'not_found' }, 404, headers);
  if (parts.length === 0 && request.method === 'POST') {
    if (!enabled) return json({ error: 'ai_disabled' }, 403, headers);
    let name = '';
    try { const body = await readJson(request); name = typeof body.name === 'string' ? body.name : ''; } catch { return json({ error: 'invalid_request' }, 400, headers); }
    // The connection looks its account up later, so the account must be known.
    await env.SHARES_DB.prepare('INSERT OR IGNORE INTO accounts (owner_id, email, name, provider, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)').bind(owner.id, owner.email, owner.name, owner.provider, Date.now(), Date.now()).run();
    const created = await createConnection(env, owner, name);
    return created ? json({ id: created.id, url: `${new URL(request.url).origin}/mcp/${created.token}` }, 201, headers) : json({ error: 'too_many_connections' }, 409, headers);
  }
  return json({ error: 'not_found' }, 404, headers);
}

/** Receives a share: either whole, or the first of several parts. */
async function upload(request: Request, env: Env, headers: Headers): Promise<Response> {
  const owner = await isAuthorized(request, env);
  if (!owner) return json({ error: 'unauthorized' }, 401, headers);
  const declared = Number(request.headers.get('content-length') ?? 0);
  const total = Number(request.headers.get('x-share-size') ?? declared);
  const parts = Number(request.headers.get('x-share-parts') ?? 1);
  const whole = [declared, total, parts].every(Number.isSafeInteger);
  if (!whole || total < 29 || total > BOUNDS.linkMiB[1] * MIB || parts < 1 || parts > 8 || parts !== (parts === 1 ? 1 : Math.ceil(total / PART_BYTES)) || (parts === 1 && total > SINGLE_BYTES) || declared !== partSize(total, parts, 0)) return json({ error: 'invalid_size' }, 413, headers);
  const reserved = await reserve(env, owner, total, parts);
  if ('error' in reserved) return json({ error: reserved.error }, reserved.status, headers);
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength !== declared) { await removeShare(env, reserved.id, owner.id); return json({ error: 'invalid_size' }, 413, headers); }
    const complete = await storePart(env, owner, reserved.id, 0, bytes, reserved.ttl);
    if (parts === 1 && !complete) throw new Error('share_activation_failed');
    return json({ id: reserved.id, expiresAt: reserved.expiresAt, parts }, 201, headers);
  } catch (error) {
    await removeShare(env, reserved.id, owner.id).catch(() => undefined);
    console.error('share_write_failed', error);
    return json({ error: 'share_write_failed' }, 500, headers);
  }
}

async function uploadPart(request: Request, env: Env, headers: Headers, id: string, part: number): Promise<Response> {
  const owner = await isAuthorized(request, env);
  if (!owner) return json({ error: 'unauthorized' }, 401, headers);
  const pending = await pendingShare(env, owner, id);
  if (!pending || !Number.isSafeInteger(part) || part < 1 || part >= pending.parts) return json({ error: 'share_unavailable' }, 404, headers);
  const expected = partSize(pending.size, pending.parts, part);
  if (Number(request.headers.get('content-length') ?? 0) !== expected) return json({ error: 'invalid_size' }, 413, headers);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== expected) return json({ error: 'invalid_size' }, 413, headers);
  return json({ complete: await storePart(env, owner, id, part, bytes, pending.ttl) }, 200, headers);
}

/** Sends the LocalDeck confirmation email to the address inside a valid Firebase token, never to one the client names. */
async function sendVerification(request: Request, env: Env, headers: Headers): Promise<Response> {
  if (!env.FIREBASE_SERVICE_ACCOUNT || !env.MAIL_RELAY_URL || !env.MAIL_RELAY_SECRET || !env.APP_URL) return json({ error: 'mail_not_configured' }, 501, headers);
  if (!await rateLimitIp(env, request, 'auth_windows', MAX_IP_MAILS_PER_HOUR, 'mail:')) return json({ error: 'rate_limited' }, 429, headers);
  let credential = '', language = 'en';
  try {
    const body = JSON.parse(new TextDecoder().decode(await readBounded(request, 12 * 1024))) as { credential?: unknown; language?: unknown };
    credential = typeof body.credential === 'string' ? body.credential : '';
    if (typeof body.language === 'string' && /^[a-z]{2}$/.test(body.language)) language = body.language;
  }
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
    await sendVerificationLink(env, claims.email, claims.name ?? '', language);
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
    const path = new URL(request.url).pathname;
    if (path === '/mcp' || path.startsWith('/mcp/')) {
      const token = path.startsWith('/mcp/') ? path.slice('/mcp/'.length).replace(/\/$/, '') : request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      return handleMcp(request, env, token, email => isAdminEmail(email, env), () => rateLimitIp(env, request, 'auth_windows', MAX_IP_AUTH_PER_HOUR, 'mcp:'));
    }
    const headers = cors(request, env);
    const origin = request.headers.get('Origin');
    if (origin && !headers.has('access-control-allow-origin')) return json({ error: 'origin_not_allowed' }, 403, headers);
    if (request.method === 'OPTIONS') return response(null, 204, headers);
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'shares') return json({ error: 'not_found' }, 404, headers);

    if (parts[3] === 'auth' && parts[4] === 'google' && parts.length === 5 && request.method === 'POST') return signIn(request, env, headers, verifyGoogleCredential);
    if (parts[3] === 'auth' && parts[4] === 'firebase' && parts.length === 5 && request.method === 'POST') return signIn(request, env, headers, verifyFirebaseCredential);
    if (parts[3] === 'auth' && parts[4] === 'verification' && parts.length === 5 && request.method === 'POST') return sendVerification(request, env, headers);

    if (parts[3] === 'admin' && parts.length > 4) return admin(request, env, headers, parts.slice(4));

    if (parts[3] === 'ai' && parts.length <= 5) return aiConnections(request, env, headers, parts.slice(4));

    if (parts[3] === 'me' && parts.length === 4 && request.method === 'GET') {
      const owner = await isAuthorized(request, env);
      if (!owner) return json({ error: 'unauthorized' }, 401, headers);
      const settings = await readSettings(env);
      return json({ admin: owner.admin, ...await limitsFor(env, owner, settings), usage: await usageFor(env, owner), open: settings.service.open || owner.admin }, 200, headers);
    }

    if (parts[3] === 'me' && parts.length === 4 && request.method === 'DELETE') {
      const owner = await isAuthorized(request, env);
      if (!owner) return json({ error: 'unauthorized' }, 401, headers);
      return json({ left: await deleteAccount(env, owner) }, 200, headers);
    }

    if (parts[3] === 'owner' && parts[4] === 'shares' && parts.length === 5 && request.method === 'GET') {
      const owner = await isAuthorized(request, env);
      if (!owner) return json({ error: 'unauthorized' }, 401, headers);
      const result = await env.SHARES_DB.prepare("SELECT id, status, created_at as createdAt, expires_at as expiresAt, size_bytes as sizeBytes, EXISTS (SELECT 1 FROM ai_projects WHERE ai_projects.id = shares.id) as ai FROM shares WHERE owner_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 50").bind(owner.id).all<{ id: string; status: string; createdAt: string; expiresAt: string; sizeBytes: number; ai: number }>();
      return json(result.results.map(row => ({ ...row, ai: Boolean(row.ai), label: row.ai ? 'Project from your AI' : 'Encrypted project' })), 200, headers);
    }

    if (parts.length === 3 && request.method === 'POST') return upload(request, env, headers);

    const id = parts[3];
    const blobRoute = parts.length === 5 && parts[4] === 'blob';
    if (!idPattern.test(id ?? '')) return json({ error: 'not_found' }, 404, headers);
    if (parts.length === 6 && parts[4] === 'parts' && request.method === 'PUT') return uploadPart(request, env, headers, id, Number(parts[5]));
    if (!await rateLimitIp(env, request, 'read_windows', MAX_IP_READS_PER_HOUR)) return json({ error: 'rate_limited' }, 429, headers);
    if (!blobRoute && request.method === 'DELETE' && parts.length === 4) {
      const owner = await isAuthorized(request, env);
      if (!owner) return json({ error: 'unauthorized' }, 401, headers);
      const removed = await removeShare(env, id, owner.admin ? null : owner.id);
      if (removed && owner.admin) await logShareRemoval(env, owner, id).catch(() => undefined);
      return removed ? json({ id, status: 'deleted' }, 200, headers) : json({ error: 'share_unavailable' }, 404, headers);
    }
    if (request.method !== 'GET') return json({ error: 'not_found' }, 404, headers);
    const row = await env.SHARES_DB.prepare('SELECT shares.id, owner_id, status, expires_at, size_bytes, COALESCE(share_meta.parts, 1) as parts FROM shares LEFT JOIN share_meta ON share_meta.id = shares.id WHERE shares.id = ?').bind(id).first<{ id: string; owner_id: string; status: string; expires_at: string; size_bytes: number; parts: number }>();
    if (!row || row.status !== 'active' || Date.parse(row.expires_at) <= Date.now()) return json({ error: 'share_unavailable' }, 410, headers);
    if (blobRoute) {
      const part = Number(url.searchParams.get('part') ?? 0);
      if (!Number.isSafeInteger(part) || part < 0 || part >= row.parts) return json({ error: 'not_found' }, 404, headers);
      const stored = part === 0 ? await readBlob(env, id) : null;
      const blob = stored === 'missing' ? null : stored?.bytes ?? await env.SHARES_KV.get(partKey(id, part), 'arrayBuffer');
      if (!blob) return json({ error: 'share_blob_missing' }, 404, headers);
      if (part === 0) await countDownload(env, id, row.owner_id).catch(error => console.error('download_not_counted', error));
      return response(blob, 200, headers, { 'content-type': 'application/octet-stream', 'content-length': String(blob.byteLength), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    }
    if (parts.length === 4) return json({ id: row.id, status: row.status, expiresAt: row.expires_at, sizeBytes: row.size_bytes, parts: row.parts }, 200, headers);
    return json({ error: 'not_found' }, 404, headers);
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> { context.waitUntil(ensureSchema(env).then(() => cleanup(env))); },
};

export default worker;
