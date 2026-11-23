interface Env {
  SHARES_KV: KVNamespace;
  SHARES_DB: D1Database;
  OWNER_TOKEN: string;
  ALLOWED_ORIGIN: string;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const idPattern = /^[a-f0-9-]{36}$/i;
const encoder = new TextEncoder();
const MAX_SHARE_BYTES = 24 * 1024 * 1024;
const MAX_ACTIVE_BYTES = 512 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
const SHARE_TTL_SECONDS = 3 * 24 * 60 * 60;

function cors(request: Request, env: Env): Headers {
  const origin = request.headers.get('Origin');
  const headers = new Headers({ 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400', vary: 'Origin' });
  if (origin && (origin === env.ALLOWED_ORIGIN || origin === 'http://localhost:5468' || origin === 'http://127.0.0.1:5468')) headers.set('access-control-allow-origin', origin);
  return headers;
}

function response(body: BodyInit | null, status: number, corsHeaders: Headers, extra?: HeadersInit): Response {
  const headers = new Headers(corsHeaders);
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(body, { status, headers });
}

function json(data: unknown, status: number, headers: Headers): Response {
  return response(JSON.stringify(data), status, headers, jsonHeaders);
}

async function clientHash(request: Request): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(ip)))).map(value => value.toString(16).padStart(2, '0')).join('');
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const hash = await clientHash(request);
  const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  await env.SHARES_DB.prepare('INSERT INTO auth_windows (client_hash, window_start, attempts) VALUES (?, ?, 1) ON CONFLICT(client_hash, window_start) DO UPDATE SET attempts = attempts + 1').bind(hash, windowStart).run();
  const attempts = await env.SHARES_DB.prepare('SELECT attempts FROM auth_windows WHERE client_hash = ? AND window_start = ?').bind(hash, windowStart).first<{ attempts: number }>();
  if ((attempts?.attempts ?? 0) > 60) return false;
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token || !env.OWNER_TOKEN || token.length > 512) return false;
  const [given, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(token)),
    crypto.subtle.digest('SHA-256', encoder.encode(env.OWNER_TOKEN)),
  ]);
  const a = new Uint8Array(given), b = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function releaseQuota(env: Env, size: number, releaseSlot = false): Promise<void> {
  await env.SHARES_DB.prepare('UPDATE storage_state SET reserved_bytes = MAX(0, reserved_bytes - ?), active_uploads = MAX(0, active_uploads - ?) WHERE id = 1').bind(size, releaseSlot ? 1 : 0).run();
}

async function cleanupExpired(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const rows = await env.SHARES_DB.prepare('SELECT id, status, size_bytes FROM shares WHERE expires_at <= ? LIMIT 100').bind(now).all<{ id: string; status: string; size_bytes: number }>();
  for (const row of rows.results) {
    const removed = await env.SHARES_DB.prepare('DELETE FROM shares WHERE id = ? AND expires_at <= ? RETURNING status, size_bytes').bind(row.id, now).first<{ status: string; size_bytes: number }>();
    if (!removed) continue;
    await env.SHARES_KV.delete(row.id).catch(() => undefined);
    if (removed.status === 'active') await releaseQuota(env, removed.size_bytes);
  }
  await env.SHARES_DB.prepare('DELETE FROM upload_windows WHERE window_start < ?').bind(Date.now() - 48 * 3_600_000).run();
  await env.SHARES_DB.prepare('DELETE FROM auth_windows WHERE window_start < ?').bind(Date.now() - 48 * 3_600_000).run();
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(request, env);
    const origin = request.headers.get('Origin');
    if (origin && !headers.has('access-control-allow-origin')) return json({ error: 'origin_not_allowed' }, 403, headers);
    if (request.method === 'OPTIONS') return response(null, 204, headers);

    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'shares') return json({ error: 'not_found' }, 404, headers);

    if (parts[3] === 'owner' && parts.length === 5 && parts[4] === 'shares' && request.method === 'GET') {
      if (!await isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401, headers);
      const result = await env.SHARES_DB.prepare('SELECT id, status, created_at as createdAt, expires_at as expiresAt, size_bytes as sizeBytes FROM shares ORDER BY created_at DESC LIMIT 100').all<{ id: string; status: string; createdAt: string; expiresAt: string; sizeBytes: number }>();
      return json(result.results.map(row => ({ ...row, label: 'Encrypted project' })), 200, headers);
    }

    const id = parts[3];
    const blobRoute = parts.length === 5 && parts[4] === 'blob';
    if (request.method === 'POST' && parts.length === 3) {
      if (!await isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401, headers);
      const hash = await clientHash(request);
      const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
      await env.SHARES_DB.prepare('INSERT INTO upload_windows (client_hash, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(client_hash, window_start) DO UPDATE SET uploads = uploads + 1').bind(hash, windowStart).run();
      const rate = await env.SHARES_DB.prepare('SELECT uploads FROM upload_windows WHERE client_hash = ? AND window_start = ?').bind(hash, windowStart).first<{ uploads: number }>();
      if ((rate?.uploads ?? 0) > 10) return json({ error: 'rate_limited' }, 429, headers);
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_SHARE_BYTES) return json({ error: 'invalid_size' }, 413, headers);

      const reservation = await env.SHARES_DB.prepare('UPDATE storage_state SET reserved_bytes = reserved_bytes + ?, active_uploads = active_uploads + 1 WHERE id = 1 AND reserved_bytes + ? <= ? AND active_uploads < ? RETURNING id').bind(declared, declared, MAX_ACTIVE_BYTES, MAX_CONCURRENT_UPLOADS).first<{ id: number }>();
      if (!reservation) return json({ error: 'storage_or_upload_limit' }, 429, headers);

      const shareId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SHARE_TTL_SECONDS * 1000).toISOString();
      let committed = false;
      try {
        const encrypted = await request.arrayBuffer();
        if (!encrypted.byteLength || encrypted.byteLength !== declared || encrypted.byteLength > MAX_SHARE_BYTES) {
          return json({ error: 'invalid_size' }, 413, headers);
        }
        await env.SHARES_KV.put(shareId, encrypted, { expirationTtl: SHARE_TTL_SECONDS });
        await env.SHARES_DB.prepare('INSERT INTO shares (id, status, created_at, expires_at, size_bytes) VALUES (?, ?, ?, ?, ?)').bind(shareId, 'active', now.toISOString(), expiresAt, encrypted.byteLength).run();
        committed = true;
        return json({ id: shareId, expiresAt }, 201, headers);
      } catch (error) {
        await env.SHARES_KV.delete(shareId).catch(() => undefined);
        console.error('share_write_failed', error);
        return json({ error: 'share_write_failed' }, 500, headers);
      } finally {
        await releaseQuota(env, committed ? 0 : declared, true);
      }
    }

    if (!idPattern.test(id ?? '')) return json({ error: 'not_found' }, 404, headers);
    const row = await env.SHARES_DB.prepare('SELECT id, status, created_at, expires_at, size_bytes FROM shares WHERE id = ?').bind(id).first<{ id: string; status: string; created_at: string; expires_at: string; size_bytes: number }>();
    if (!row || row.status !== 'active' || Date.parse(row.expires_at) <= Date.now()) return json({ error: 'share_unavailable' }, 410, headers);
    if (blobRoute && request.method === 'GET') {
      const blob = await env.SHARES_KV.get(id, 'arrayBuffer');
      if (!blob) return json({ error: 'share_blob_missing' }, 404, headers);
      return response(blob, 200, headers, { 'content-type': 'application/octet-stream', 'content-length': String(blob.byteLength), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    }
    if (!blobRoute && request.method === 'GET' && parts.length === 4) {
      return json({ id: row.id, status: row.status, expiresAt: row.expires_at, sizeBytes: row.size_bytes }, 200, headers);
    }
    if (!blobRoute && request.method === 'DELETE' && parts.length === 4) {
      if (!await isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401, headers);
      const removed = await env.SHARES_DB.prepare("UPDATE shares SET status = 'revoked' WHERE id = ? AND status = 'active' RETURNING size_bytes").bind(id).first<{ size_bytes: number }>();
      if (removed) {
        await env.SHARES_KV.delete(id);
        await releaseQuota(env, removed.size_bytes);
      }
      return json({ id, status: 'revoked' }, 200, headers);
    }
    return json({ error: 'not_found' }, 404, headers);
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(cleanupExpired(env));
  },
};

export default worker;

