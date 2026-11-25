/* Tells the sharing service that LocalDeck was opened, so the operator knows how many people use it.
   Nothing about the visit is sent: no name, no identifier, no page, no project. Nothing is stored on the device either,
   only the wish not to be counted. The browser settings "Do Not Track" and "Global Privacy Control" count as that wish. */
const OFF_KEY = 'localdeck-no-count';

export function countsVisits(): boolean { try { return localStorage.getItem(OFF_KEY) !== '1'; } catch { return true; } }
export function setCountsVisits(on: boolean): void { try { if (on) localStorage.removeItem(OFF_KEY); else localStorage.setItem(OFF_KEY, '1'); } catch { /* storage unavailable */ } }

type Asked = Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
export function mayCount(browser: Pick<Asked, 'globalPrivacyControl' | 'doNotTrack' | 'webdriver'>): boolean {
  return countsVisits() && browser.globalPrivacyControl !== true && browser.doNotTrack !== '1' && browser.webdriver !== true;
}

let countedDay = '';
/** Once when LocalDeck is opened, and again when it stays open into a new day. A missing connection does not matter. */
export function countVisit(api: string): () => void {
  if (!api) return () => undefined;
  const send = () => {
    const day = new Date().toISOString().slice(0, 10);
    if (document.visibilityState !== 'visible' || countedDay === day || !navigator.onLine || !mayCount(navigator as Asked)) return;
    countedDay = day;
    void fetch(`${api}/api/v1/shares/visit`, { method: 'POST', credentials: 'omit', referrerPolicy: 'origin', keepalive: true }).catch(() => { countedDay = ''; });
  };
  send();
  document.addEventListener('visibilitychange', send);
  window.addEventListener('online', send);
  return () => { document.removeEventListener('visibilitychange', send); window.removeEventListener('online', send); };
}
