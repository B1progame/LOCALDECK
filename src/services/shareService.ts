/* Talks to the sharing Worker: account limits, uploads and downloads. Large projects travel in parts. */
import { fetchShare, type ShareReply } from './shareLink.ts';

const MIB = 1024 * 1024;
/** Must match PART_BYTES and SINGLE_BYTES in cloudflare/worker/src/service.ts. */
export const PART_BYTES = 20 * MIB;
export const SINGLE_BYTES = 24 * MIB;

export type Limits = { linkMiB: number; storageMiB: number; perHour: number; perDay: number; days: number };
export type ShareAccount = { admin: boolean; limits: Limits; usage: { bytes: number; links: number; hour: number; day: number } | null; open: boolean; blocked: boolean };

/** Used when the Worker is older than this app and does not know the request. */
export const DEFAULT_ACCOUNT: ShareAccount = { admin: false, limits: { linkMiB: 24, storageMiB: 48, perHour: 5, perDay: 15, days: 3 }, usage: null, open: true, blocked: false };

export async function getAccount(api: string, token: string): Promise<ShareAccount> {
  try {
    const response = await fetch(`${api}/api/v1/shares/me`, { headers: { Authorization: `Bearer ${token}` } });
    return response.ok ? { ...DEFAULT_ACCOUNT, ...await response.json() as Partial<ShareAccount> } : DEFAULT_ACCOUNT;
  } catch { return DEFAULT_ACCOUNT; }
}

export const partCount = (size: number) => size <= SINGLE_BYTES ? 1 : Math.ceil(size / PART_BYTES);

async function refusal(response: Response): Promise<Error> {
  const { error } = await response.json().catch(() => ({})) as { error?: string };
  const known: Record<string, string> = {
    blocked: 'This account is blocked. Contact the operator of this service.',
    uploads_paused: 'New links are paused at the moment. Try again later.',
    user_storage_limit: 'Your storage is full. Delete a link or wait until one expires.',
    storage_or_upload_limit: 'The service is full or busy right now. Try again later.',
    daily_rate_limited: 'The upload limit for today is reached. Try again tomorrow.',
    rate_limited: 'Too many uploads in the last hour. Wait a little, then try again.',
    invalid_size: 'This project is too large for a link.',
  };
  if (response.status === 401) return new Error('Your sign-in expired. Sign in again and retry.');
  return new Error(known[error ?? ''] ?? `Share upload failed (${response.status}).`);
}

/** Uploads the encrypted project. `onProgress` gets a value from 0 to 1 after every part. */
export async function uploadShare(api: string, token: string, payload: Blob, onProgress: (value: number) => void = () => undefined, wait = 1000): Promise<{ id: string; expiresAt: string }> {
  const url = `${api}/api/v1/shares`;
  const parts = partCount(payload.size);
  const slice = (part: number) => parts === 1 ? payload : payload.slice(part * PART_BYTES, (part + 1) * PART_BYTES, 'application/octet-stream');
  const authorization = { Authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' };
  const first = await fetch(url, { method: 'POST', headers: parts === 1 ? authorization : { ...authorization, 'x-share-size': String(payload.size), 'x-share-parts': String(parts) }, body: slice(0) });
  if (!first.ok) throw await refusal(first);
  const share = await first.json() as { id: string; expiresAt: string };
  onProgress(1 / parts);
  try {
    for (let part = 1; part < parts; part++) {
      for (let attempt = 0; ; attempt++) {
        let response: Response | null = null;
        try { response = await fetch(`${url}/${share.id}/parts/${part}`, { method: 'PUT', headers: authorization, body: slice(part) }); } catch { /* retried below */ }
        if (response?.ok) break;
        if (response && response.status < 500) throw await refusal(response);
        if (attempt >= 2) throw response ? await refusal(response) : new Error('The connection broke during the upload. Try again.');
        await new Promise(resolve => setTimeout(resolve, wait * (attempt + 1)));
      }
      onProgress((part + 1) / parts);
    }
  } catch (error) {
    // Frees the reserved space at once instead of after the cleanup.
    void fetch(`${url}/${share.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    throw error;
  }
  return share;
}

/** Downloads all parts of a share. The reply of the first failing part is returned as it is. */
export async function downloadShare(url: string, parts: number, onProgress: (value: number) => void = () => undefined, fetcher?: (url: string) => Promise<Response>, delay = 1500): Promise<{ data: ArrayBuffer } | { failed: ShareReply }> {
  const blobs: ArrayBuffer[] = [];
  for (let part = 0; part < parts; part++) {
    const reply = await fetchShare(`${url}/blob${parts > 1 ? `?part=${part}` : ''}`, fetcher, delay, true);
    if (!reply.response?.ok) return { failed: reply };
    blobs.push(await reply.response.arrayBuffer());
    onProgress((part + 1) / parts);
  }
  if (blobs.length === 1) return { data: blobs[0]! };
  return { data: await new Blob(blobs).arrayBuffer() };
}
