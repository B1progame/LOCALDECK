/* Keyboard, focus and motion helpers shared by the whole app. */
import React, { useEffect, useState, useSyncExternalStore } from 'react';

const KEY_STEP: Record<string, number | 'first' | 'last'> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };

/** Arrow keys, Home and End move focus between the items of a menu, tab list or radio group.
    With `activate`, moving also selects, which is what tabs and radios are expected to do. */
export function rovingKeys(event: React.KeyboardEvent<HTMLElement>, selector: string, activate = false): void {
  const step = KEY_STEP[event.key];
  if (step === undefined) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(item => !item.hasAttribute('disabled'));
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = step === 'first' ? 0 : step === 'last' ? items.length - 1 : (Math.max(current, 0) + step + items.length) % items.length;
  items[next]!.focus();
  if (activate) items[next]!.click();
}

/** Remembers what was focused when the component appeared and returns focus there when it goes away. */
export function useReturnFocus(): void {
  const [origin] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => { if (origin?.isConnected) origin.focus(); }, [origin]);
}

/* ---------- Connection ---------- */

function subscribeConnection(notify: () => void): () => void {
  window.addEventListener('online', notify); window.addEventListener('offline', notify);
  navigator.serviceWorker?.addEventListener('controllerchange', notify);
  return () => {
    window.removeEventListener('online', notify); window.removeEventListener('offline', notify);
    navigator.serviceWorker?.removeEventListener('controllerchange', notify);
  };
}
export type Connection = 'offline-ready' | 'online' | 'offline';
/** "offline-ready" is only reported when the service worker really controls this page. */
export function useConnection(): Connection {
  return useSyncExternalStore(subscribeConnection, () => !navigator.onLine ? 'offline' : navigator.serviceWorker?.controller ? 'offline-ready' : 'online');
}

/* ---------- Background motion ---------- */

const AMBIENT_KEY = 'localdeck-ambient';
const AMBIENT_CLASS = 'ambient-paused';
const root = document.documentElement;
try { root.classList.toggle(AMBIENT_CLASS, localStorage.getItem(AMBIENT_KEY) === 'paused'); } catch { /* storage unavailable */ }

function subscribeRootClass(notify: () => void): () => void {
  const observer = new MutationObserver(notify);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
const ambientPaused = () => root.classList.contains(AMBIENT_CLASS);
const systemReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True when decorative loops should stand still: paused here, reduced in Settings, or reduced by the system. */
export function useStillMotion(): boolean {
  return useSyncExternalStore(subscribeRootClass, () => ambientPaused() || root.classList.contains('reduce-motion') || systemReduced());
}

/** Settings switch for the decorative, endlessly looping animations. */
export function useBackgroundMotion(): [boolean, (playing: boolean) => void] {
  const playing = !useSyncExternalStore(subscribeRootClass, ambientPaused);
  const setPlaying = (next: boolean) => {
    root.classList.toggle(AMBIENT_CLASS, !next);
    try { localStorage.setItem(AMBIENT_KEY, next ? 'playing' : 'paused'); } catch { /* storage unavailable */ }
  };
  return [playing, setPlaying];
}
