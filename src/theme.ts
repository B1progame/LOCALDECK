import { useCallback, useEffect, useState } from 'react';

export type ThemeId = 'system' | 'obsidian' | 'midnight' | 'forest' | 'rose' | 'pearl';
export type Appearance = { theme: ThemeId; accent: string | null };

export const THEMES: Array<{ id: ThemeId; label: string; detail: string; swatch: [string, string, string] }> = [
  { id: 'system', label: 'System', detail: 'Follows your device', swatch: ['#F4F3F8', '#0B0C12', '#A78BFA'] },
  { id: 'obsidian', label: 'Obsidian', detail: 'Graphite and violet', swatch: ['#0B0C12', '#22232F', '#A78BFA'] },
  { id: 'midnight', label: 'Midnight', detail: 'Navy and blue', swatch: ['#0A0F1C', '#1C2438', '#7AA2F7'] },
  { id: 'forest', label: 'Forest', detail: 'Deep green and mint', swatch: ['#0A110F', '#1B2622', '#5DD5A2'] },
  { id: 'rose', label: 'Rose', detail: 'Charcoal and pink', swatch: ['#110D10', '#2A2127', '#F08FB4'] },
  { id: 'pearl', label: 'Pearl', detail: 'Soft light', swatch: ['#F4F3F8', '#FFFFFF', '#7C5CE0'] },
];

export const ACCENTS = ['#A78BFA', '#7AA2F7', '#5CC8E0', '#5DD5A2', '#F6C76A', '#F59E6B', '#F08091', '#E58AD6'];

const KEY = 'localdeck-appearance';
const DARK_DEFAULT: Exclude<ThemeId, 'system'> = 'obsidian';

export function readAppearance(): Appearance {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<Appearance> | null;
    const theme = THEMES.some(t => t.id === value?.theme) ? value!.theme! : 'system';
    const accent = typeof value?.accent === 'string' && /^#[0-9a-f]{6}$/i.test(value.accent) ? value.accent : null;
    return { theme, accent };
  } catch {
    return { theme: 'system', accent: null };
  }
}

function resolve(theme: ThemeId): Exclude<ThemeId, 'system'> {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'pearl' : DARK_DEFAULT;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Applies the theme to <html>. The same logic runs inline in index.html to avoid a flash. */
export function applyAppearance(value: Appearance): void {
  const root = document.documentElement;
  const resolved = resolve(value.theme);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved === 'pearl' ? 'light' : 'dark';
  if (value.accent) {
    const [r, g, b] = hexToRgb(value.accent);
    root.style.setProperty('--accent', value.accent);
    root.style.setProperty('--accent-rgb', `${r} ${g} ${b}`);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    root.style.setProperty('--on-accent', luminance > 0.55 ? '#14111F' : '#FFFFFF');
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-rgb');
    root.style.removeProperty('--on-accent');
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#0B0C12');
}

export function useAppearance() {
  const [appearance, setAppearanceState] = useState<Appearance>(readAppearance);
  useEffect(() => {
    applyAppearance(appearance);
    if (appearance.theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyAppearance(appearance);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [appearance]);
  const setAppearance = useCallback((next: Partial<Appearance>) => {
    setAppearanceState(current => {
      const merged = { ...current, ...next };
      try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* storage unavailable */ }
      return merged;
    });
  }, []);
  const isLight = () => document.documentElement.dataset.theme === 'pearl';
  /** Quick toggle in the top bar: switches between Pearl and the dark preset. */
  const toggleLight = useCallback(() => {
    setAppearance({ theme: isLight() ? DARK_DEFAULT : 'pearl' });
  }, [setAppearance]);
  return { appearance, setAppearance, toggleLight, resolved: typeof document !== 'undefined' ? resolve(appearance.theme) : DARK_DEFAULT };
}
