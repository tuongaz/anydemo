export const ICON_RECENTS_STORAGE_KEY = 'seeflow:icon-recents';

const MAX_RECENTS = 16;

export function getRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ICON_RECENTS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    if (!parsed.every((entry) => typeof entry === 'string')) return [];
    return parsed as string[];
  } catch {
    return [];
  }
}

export function pushRecent(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getRecents();
    const deduped = current.filter((entry) => entry !== name);
    const next = [name, ...deduped].slice(0, MAX_RECENTS);
    window.localStorage.setItem(ICON_RECENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable (private mode, quota, etc.) — non-fatal.
  }
}
