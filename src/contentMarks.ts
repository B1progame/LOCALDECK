/* Whether 16+ and 18+ marks are shown. Off by default, the person turns them on in Settings.
   The check itself always runs on the device, so the marks are there at once when they are turned on. */
import { create } from 'zustand';
import type { ContentCheck } from './services/contentCheck';

const KEY = 'localdeck-content-marks';
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const useContentMarks = create<{ on: boolean }>(() => ({ on: read() }));
export function setContentMarks(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  useContentMarks.setState({ on });
}
/** The hashtags to show: the own ones, and #16+ or #18+ while marks are on. They are not saved, so they go away with the mark. */
export function tagsWithMark(tags: string[], check: ContentCheck | null | undefined, on = useContentMarks.getState().on): string[] {
  if (!on || !check || check.rating === 'ok' || check.confirmed) return tags;
  return tags.some(tag => tag === `${check.rating}+` || tag.toLowerCase() === `${check.rating}plus`) ? tags : [...tags, `${check.rating}+`];
}
/** True when the person wants to be asked before this project is opened. */
export const asksFirst = (check: ContentCheck | null | undefined) => useContentMarks.getState().on && check?.rating === '18' && !check.confirmed;
