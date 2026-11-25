/* The sign-in of this person. A token is valid for one hour. It is renewed in the background, so nobody is signed out
   while the account exists. "Stay signed in" keeps it after the browser is closed, otherwise it ends with the tab. */
import { create } from 'zustand';

export type ShareSession = { token: string; exp: number; email: string; name: string; picture: string; admin?: boolean; refresh?: string };
export type Credential = { token: string; refresh?: string };

const KEY = 'localdeck-session', OLD_KEY = 'localdeck-google-share-session', STAY_KEY = 'localdeck-stay';
/** Renewed this many seconds before it ends. */
const EARLY = 300;
/** After one of these answers of Firebase a new sign-in is the only way. Anything else may be a short outage. */
const ENDED = /TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN|INVALID_GRANT|MISSING_REFRESH_TOKEN/i;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (kind: 'localStorage' | 'sessionStorage'): Store | null => { try { return globalThis[kind] ?? null; } catch { return null; } };
const seconds = () => Math.floor(Date.now() / 1000);

export function staysSignedIn(): boolean { try { return storage('localStorage')?.getItem(STAY_KEY) !== '0'; } catch { return true; } }
export function setStaySignedIn(stay: boolean): void { try { storage('localStorage')?.setItem(STAY_KEY, stay ? '1' : '0'); } catch { /* storage unavailable */ } }

function parse(text: string | null | undefined): ShareSession | null {
  try {
    const value = JSON.parse(text || 'null') as ShareSession | null;
    if (!value || typeof value.token !== 'string' || typeof value.exp !== 'number' || typeof value.email !== 'string') return null;
    // Without a way to renew it, a session ends with its token.
    return value.refresh || value.exp > seconds() + 15 ? value : null;
  } catch { return null; }
}

function read(): ShareSession | null {
  for (const [kind, key] of [['sessionStorage', KEY], ['localStorage', KEY], ['sessionStorage', OLD_KEY]] as const) {
    try { const found = parse(storage(kind)?.getItem(key)); if (found) return found; } catch { /* storage unavailable */ }
  }
  return null;
}

function store(session: ShareSession | null): void {
  for (const [kind, key] of [['sessionStorage', KEY], ['localStorage', KEY], ['sessionStorage', OLD_KEY]] as const) try { storage(kind)?.removeItem(key); } catch { /* storage unavailable */ }
  if (session) try { storage(staysSignedIn() ? 'localStorage' : 'sessionStorage')?.setItem(KEY, JSON.stringify(session)); } catch { /* the session then ends with this page */ }
  useSession.setState({ session });
}

/** `ended`: the account was signed out by Firebase, for example because it was deleted or its password changed. */
export const useSession = create<{ session: ShareSession | null; ended: boolean }>(() => ({ session: read(), ended: false }));

export function getShareSession(): ShareSession | null {
  const { session } = useSession.getState();
  if (session && !session.refresh && session.exp <= seconds() + 15) { signOutHere(); return null; }
  return session;
}

/** The time a token ends. It is only read here, the server checks it. */
export function tokenEnd(token: string): number {
  const part = token.split('.')[1];
  if (!part) throw new Error('Google returned an invalid sign-in token.');
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), char => char.charCodeAt(0)))) as { exp?: number };
  if (typeof claims.exp !== 'number') throw new Error('Google returned an invalid sign-in token.');
  return claims.exp;
}

export function saveShareSession(credential: Credential, profile: { email: string; name: string; picture: string; admin?: boolean }): ShareSession {
  const session: ShareSession = { token: credential.token, exp: tokenEnd(credential.token), email: profile.email, name: profile.name, picture: profile.picture, admin: profile.admin === true, ...(credential.refresh ? { refresh: credential.refresh } : {}) };
  store(session);
  useSession.setState({ ended: false });
  return session;
}

/** The server says this account is no admin (any more). */
export function dropAdmin(): void { const { session } = useSession.getState(); if (session?.admin) store({ ...session, admin: false }); }

export function signOutHere(ended = false): void { store(null); useSession.setState({ ended }); }

let apiKey = '';
let running: Promise<string | null> | null = null;

async function renew(): Promise<string | null> {
  // Another tab may have renewed it already.
  const saved = read(), current = useSession.getState().session;
  if (saved && current && saved.email === current.email && saved.token !== current.token && saved.exp > seconds() + EARLY) { useSession.setState({ session: saved }); return saved.token; }
  if (!current) return null;
  if (!current.refresh || !apiKey) return current.exp > seconds() ? current.token : null;
  let response: Response, result: { id_token?: string; refresh_token?: string; error?: { message?: string } };
  try {
    response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refresh }) });
    result = await response.json() as typeof result;
  } catch { return current.exp > seconds() ? current.token : null; }
  // Signed out or someone else signed in while this was on its way.
  if (useSession.getState().session?.refresh !== current.refresh) return useSession.getState().session?.token ?? null;
  if (response.ok && result.id_token) {
    store({ ...current, token: result.id_token, exp: tokenEnd(result.id_token), refresh: result.refresh_token || current.refresh });
    return result.id_token;
  }
  if (ENDED.test(result.error?.message ?? '')) { signOutHere(true); return null; }
  return current.exp > seconds() ? current.token : null;
}

/** A token that is valid for at least a few minutes, or null when nobody is signed in. */
export async function freshToken(force = false): Promise<string | null> {
  const session = getShareSession();
  if (!session) return null;
  if (!force && session.exp > seconds() + EARLY) return session.token;
  running ??= renew().finally(() => { running = null; });
  return running;
}

/** A request with the sign-in. When the server does not accept it, it is renewed and tried once more. */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | null) => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const first = await freshToken();
  const response = await send(first);
  if (response.status !== 401 || !first || !useSession.getState().session?.refresh) return response;
  const second = await freshToken(true);
  return second && second !== first ? send(second) : response;
}

/** Renews the sign-in while the app is open and keeps all tabs in step. */
export function keepSignedIn(firebaseKey: string): () => void {
  apiKey = firebaseKey;
  const check = () => { if (document.visibilityState === 'visible') void freshToken(); };
  const changed = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { const session = read(); if (session?.token !== useSession.getState().session?.token) useSession.setState({ session }); } };
  check();
  const timer = window.setInterval(check, 60_000);
  for (const name of ['focus', 'online']) window.addEventListener(name, check);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('storage', changed);
  return () => { window.clearInterval(timer); for (const name of ['focus', 'online']) window.removeEventListener(name, check); document.removeEventListener('visibilitychange', check); window.removeEventListener('storage', changed); };
}
