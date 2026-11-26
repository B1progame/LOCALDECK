import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { turnTheme } from './fx';

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

type Rgb = [number, number, number];
function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The picked color, darkened in the light theme or lightened in dark ones until it is readable as text. */
export function readableAccent(hex: string, light: boolean): { accent: Rgb; onAccent: string } {
  const picked = hexToRgb(hex);
  // Accent text sits on plain surfaces and on a 14% tint of itself, so check both.
  const surfaces: Rgb[] = light ? [[255, 255, 255], [236, 235, 243]] : [[23, 24, 33], [37, 48, 73], [51, 42, 49], [43, 44, 59]];
  const toward = light ? 0 : 255;
  let accent = picked;
  for (let step = 0; step <= 100; step++) {
    accent = picked.map(value => Math.round(value + (toward - value) * step / 100)) as Rgb;
    const tinted = surfaces.map(surface => surface.map((value, i) => value + (accent[i]! - value) * 0.14) as Rgb);
    if ([...surfaces, ...tinted].every(surface => contrastRatio(accent, surface) >= 4.5)) break;
  }
  return { accent, onAccent: contrastRatio(accent, [255, 255, 255]) >= contrastRatio(accent, [20, 17, 31]) ? '#FFFFFF' : '#14111F' };
}

/** Applies the theme to <html>. index.html sets the theme before first paint; the accent follows here. */
export function applyAppearance(value: Appearance): void {
  const root = document.documentElement;
  const resolved = resolve(value.theme);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved === 'pearl' ? 'light' : 'dark';
  if (value.accent) {
    const { accent, onAccent } = readableAccent(value.accent, resolved === 'pearl');
    root.style.setProperty('--accent', `rgb(${accent.join(' ')})`);
    root.style.setProperty('--accent-rgb', accent.join(' '));
    root.style.setProperty('--on-accent', onAccent);
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
  const current = useRef(appearance);
  current.current = appearance;
  useEffect(() => {
    applyAppearance(appearance);
    if (appearance.theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyAppearance(appearance);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [appearance]);
  const setAppearance = useCallback((next: Partial<Appearance>) => {
    const merged = { ...current.current, ...next };
    current.current = merged;
    try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* storage unavailable */ }
    if (resolve(merged.theme) === document.documentElement.dataset.theme) { setAppearanceState(merged); return; }
    turnTheme(() => { flushSync(() => setAppearanceState(merged)); applyAppearance(merged); }, () => document.documentElement.dataset.theme === 'pearl');
  }, []);
  const isLight = () => document.documentElement.dataset.theme === 'pearl';
  /** Quick toggle in the top bar: switches between Pearl and the dark preset. */
  const toggleLight = useCallback(() => {
    setAppearance({ theme: isLight() ? DARK_DEFAULT : 'pearl' });
  }, [setAppearance]);
  return { appearance, setAppearance, toggleLight, resolved: typeof document !== 'undefined' ? resolve(appearance.theme) : DARK_DEFAULT };
}
