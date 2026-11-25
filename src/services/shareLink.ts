/* Reading share links and explaining why one could not be opened. */

export type SharedRoute = { id: string; key: string };
export type ShareProblem = { title: string; message: string; retry: boolean };

/** Reads `shared/<id>?k=<key>`. Messengers and mail apps sometimes encode the "?", add tracking
    parameters, invisible characters or a closing bracket, so both parts are searched for, not split off. */
export function parseSharedRoute(hash: string): SharedRoute {
  let text = hash;
  try { text = decodeURIComponent(hash); } catch { /* keep the raw text when the encoding is broken */ }
  const id = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0].toLowerCase() ?? '';
  const key = text.match(/[?&]k=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/)?.[1] ?? '';
  return { id, key };
}

/** Status 0 means the sharing service could not be reached at all. */
export function shareProblem(status: number): ShareProblem {
  if (status === 410) return { title: 'This share has ended', message: 'The link expired, or its owner deleted it. Ask for a new link.', retry: false };
  if (status === 404) return { title: 'This link does not match a share', message: 'Part of the link may have been lost when it was copied. Ask for the complete link again.', retry: false };
  if (status === 429) return { title: 'Too many requests', message: 'Your network opened a lot of shares in the last hour. Wait a little, then try again.', retry: true };
  if (status === 0) return { title: 'The sharing service did not answer', message: 'Check your internet connection, then try again. The free service may also have reached its limit for today, then it works again tomorrow. The link itself is still fine.', retry: true };
  return { title: 'The sharing service has a problem', message: 'This is usually over in a moment. The link itself is still fine, so try again.', retry: true };
}

export type ShareReply = { status: number; response: Response | null };

/** Fetches with two quiet retries for outages. `retryMissing` also retries 404, because a fresh
    upload can take a moment to reach every Cloudflare location. */
export async function fetchShare(url: string, fetcher: (url: string) => Promise<Response> = input => fetch(input, { cache: 'no-store' }), delay = 700, retryMissing = false): Promise<ShareReply> {
  let reply: ShareReply = { status: 0, response: null };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, delay * attempt));
    try { const response = await fetcher(url); reply = { status: response.status, response }; }
    catch { reply = { status: 0, response: null }; }
    if (reply.status !== 0 && reply.status < 500 && !(retryMissing && reply.status === 404)) break;
  }
  return reply;
}
