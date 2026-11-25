/* Slows down wrong passwords and repeated emails in this browser.
   It protects against guessing at this device and against accidental clicking. The real limit is in Firebase and in
   the Worker, because a program can talk to Firebase without this page. */
type Entry = { wrong: number; until: number; last: number };
type Guard = Record<string, Entry>;

const KEY = 'localdeck-login-guard';
const FREE = 4;
const FIRST_WAIT = 30_000, LONGEST_WAIT = 15 * 60_000, FORGET = 60 * 60_000;
export const MAIL_WAIT = 60_000;

function read(now: number): Guard {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}') as Guard;
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry && Number.isFinite(entry.until) && Number.isFinite(entry.wrong) && (entry.until > now || entry.last > now - FORGET)));
  } catch { return {}; }
}
function write(guard: Guard): void {
  try { if (Object.keys(guard).length) localStorage.setItem(KEY, JSON.stringify(guard)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

/** Seconds until the next try, 0 when it may happen now. */
export function waitFor(action: string, now = Date.now()): number {
  const until = read(now)[action]?.until ?? 0;
  // A clock that was set back must not lock anyone out for long.
  return until > now && until - now <= LONGEST_WAIT ? Math.ceil((until - now) / 1000) : 0;
}

/** Four wrong passwords are free. Then every further one doubles the waiting time, up to 15 minutes. */
export function wrongPassword(now = Date.now()): void {
  const guard = read(now), wrong = (guard.password?.wrong ?? 0) + 1;
  guard.password = { wrong, last: now, until: wrong > FREE ? now + Math.min(LONGEST_WAIT, FIRST_WAIT * 2 ** (wrong - FREE - 1)) : 0 };
  write(guard);
}
export function rightPassword(): void {
  const guard = read(Date.now());
  delete guard.password;
  write(guard);
}

/** One email of a kind per minute. */
export function mailSent(kind: 'link' | 'reset', now = Date.now()): void {
  const guard = read(now);
  guard[kind] = { wrong: 0, last: now, until: now + MAIL_WAIT };
  write(guard);
}
