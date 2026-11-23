interface Env {
  SHARES_DB: D1Database;
  SHARES_BUCKET: R2Bucket;
  OWNER_TOKEN: string;
  ALLOWED_ORIGIN: string;
  MAX_SHARE_BYTES?: string;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const idPattern = /^[a-f0-9-]{36}$/i;
const encoder = new TextEncoder();

function cors(request: Request, env: Env): Headers {
  const origin = request.headers.get('Origin');
  const headers = new Headers({ 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-share-expires-in', 'access-control-max-age': '86400', vary: 'Origin' });
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

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
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

async function cleanupExpired(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const rows = await env.SHARES_DB.prepare('SELECT id, object_key FROM shares WHERE expires_at <= ?').bind(now).all<{ id: string; object_key: string }>();
  for (const row of rows.results) await env.SHARES_BUCKET.delete(row.object_key);
  await env.SHARES_DB.prepare('DELETE FROM shares WHERE expires_at <= ?').bind(now).run();
  await env.SHARES_DB.prepare('DELETE FROM upload_windows WHERE window_start < ?').bind(Date.now() - 48 * 3_600_000).run();
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
      const result = await env.SHARES_DB.prepare('SELECT id, status, created_at as createdAt, expires_at as expiresAt, size_bytes as sizeBytes FROM shares ORDER BY created_at DESC LIMIT 100').all<{ id:string; status:string; createdAt:string; expiresAt:string; sizeBytes:number }>();
      return json(result.results.map(row => ({ ...row, label: 'Encrypted project' })), 200, headers);
    }

    const id = parts[3];
    const blobRoute = parts.length === 5 && parts[4] === 'blob';

    if (request.method === 'POST' && parts.length === 3) {
      if (!await isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401, headers);
      const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const clientHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(clientIp)))).map(value => value.toString(16).padStart(2, '0')).join('');
      const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
      await env.SHARES_DB.prepare('INSERT INTO upload_windows (client_hash, window_start, uploads) VALUES (?, ?, 1) ON CONFLICT(client_hash, window_start) DO UPDATE SET uploads = uploads + 1').bind(clientHash, windowStart).run();
      const rate = await env.SHARES_DB.prepare('SELECT uploads FROM upload_windows WHERE client_hash = ? AND window_start = ?').bind(clientHash, windowStart).first<{ uploads: number }>();
      if ((rate?.uploads ?? 0) > 10) return json({ error: 'rate_limited' }, 429, headers);
      const declared = Number(request.headers.get('content-length') ?? 0);
      const limit = Math.min(50 * 1024 * 1024, Math.max(1024, Number(env.MAX_SHARE_BYTES) || 50 * 1024 * 1024));
      if (declared > limit) return json({ error: 'invalid_size' }, 413, headers);
      const days = Number(request.headers.get('x-share-expires-in') ?? 7);
      if (![1 / 24, 1, 7, 30].includes(days)) return json({ error: 'invalid_expiration' }, 400, headers);
      const capacity = await env.SHARES_DB.prepare('SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as bytes FROM shares WHERE status = \'active\' AND expires_at > ?').bind(new Date().toISOString()).first<{ count: number; bytes: number }>();
      if ((capacity?.count ?? 0) >= 200 || (capacity?.bytes ?? 0) >= 512 * 1024 * 1024) return json({ error: 'storage_quota' }, 429, headers);
      const shareId = crypto.randomUUID();
      const now = new Date(), expiresAt = new Date(now.getTime() + days * 86400_000).toISOString(), objectKey = `${shareId}.bin`;
      try {
        const encrypted = await request.arrayBuffer();
        if (!encrypted.byteLength || encrypted.byteLength > limit) return json({ error: 'invalid_size' }, 413, headers);
        if ((capacity?.bytes ?? 0) + encrypted.byteLength > 512 * 1024 * 1024) return json({ error: 'storage_quota' }, 429, headers);
        await env.SHARES_BUCKET.put(objectKey, encrypted, { httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'no-store' } });
        const stored = await env.SHARES_BUCKET.head(objectKey);
        if (!stored || stored.size !== encrypted.byteLength) throw new Error('Stored object verification failed.');
        await env.SHARES_DB.prepare('INSERT INTO shares (id, object_key, status, created_at, expires_at, size_bytes) VALUES (?, ?, ?, ?, ?, ?)').bind(shareId, objectKey, 'active', now.toISOString(), expiresAt, encrypted.byteLength).run();
        return json({ id: shareId, expiresAt }, 201, headers);
      } catch (error) {
        await env.SHARES_BUCKET.delete(objectKey);
        console.error('share_write_failed', error);
        return json({ error: 'share_write_failed' }, 500, headers);
      }
    }

    if (!idPattern.test(id ?? '')) return json({ error: 'not_found' }, 404, headers);
    const row = await env.SHARES_DB.prepare('SELECT id, object_key, status, created_at, expires_at, size_bytes FROM shares WHERE id = ?').bind(id).first<{ id: string; object_key: string; status: string; created_at: string; expires_at: string; size_bytes: number }>();
    if (!row || row.status !== 'active' || Date.parse(row.expires_at) <= Date.now()) return json({ error: 'share_unavailable' }, 410, headers);
    if (blobRoute && request.method === 'GET') {
      const object = await env.SHARES_BUCKET.get(row.object_key);
      if (!object) return json({ error: 'share_blob_missing' }, 404, headers);
      const responseHeaders = new Headers(headers);
      object.writeHttpMetadata(responseHeaders);
      responseHeaders.set('content-type', 'application/octet-stream');
      responseHeaders.set('content-length', String(object.size));
      responseHeaders.set('cache-control', 'no-store');
      responseHeaders.set('x-content-type-options', 'nosniff');
      return new Response(object.body, { headers: responseHeaders });
    }
    if (!blobRoute && request.method === 'GET' && parts.length === 4) {
      return json({ id: row.id, status: row.status, expiresAt: row.expires_at, sizeBytes: row.size_bytes }, 200, headers);
    }
    if (!blobRoute && request.method === 'DELETE' && parts.length === 4) {
      if (!await isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401, headers);
      await env.SHARES_BUCKET.delete(row.object_key);
      await env.SHARES_DB.prepare("UPDATE shares SET status = 'revoked' WHERE id = ?").bind(id).run();
      return json({ id, status: 'revoked' }, 200, headers);
    }
    return json({ error: 'not_found' }, 404, headers);
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(cleanupExpired(env));
  },
};

export default worker;
