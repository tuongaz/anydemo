import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'seeflow:theme';
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

type Readable = Pick<Storage, 'getItem'>;
type Writable = Pick<Storage, 'setItem'>;

export function readStoredTheme(storage: Readable): Theme {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Read the `theme` query-string param off a URL search string. Mirrors the
 * FOUC script in apps/web/index.html: when the param is present but invalid,
 * we resolve to 'light' (the new package default). Returns `null` when the
 * param is absent so callers can fall through to the studio's localStorage +
 * matchMedia chain.
 */
export function readUrlTheme(search: string): ResolvedTheme | null {
  try {
    const params = new URLSearchParams(search);
    if (!params.has('theme')) return null;
    const raw = params.get('theme');
    if (raw === 'light' || raw === 'dark') return raw;
    return 'light';
  } catch {
    return null;
  }
}

export function writeStoredTheme(storage: Writable, theme: Theme): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage can throw in private-browsing or when quota is exceeded; the
    // toggle should keep working in-memory either way.
  }
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

interface ClassListLike {
  add(token: string): void;
  remove(token: string): void;
}

export function applyThemeToHtml(
  html: { classList: ClassListLike },
  resolved: ResolvedTheme,
): void {
  if (resolved === 'dark') {
    html.classList.add('dark');
    html.classList.remove('light');
  } else {
    html.classList.add('light');
    html.classList.remove('dark');
  }
}

interface MediaQueryListLike {
  matches: boolean;
  addEventListener?(type: 'change', listener: (e: MediaQueryListEvent) => void): void;
  removeEventListener?(type: 'change', listener: (e: MediaQueryListEvent) => void): void;
  addListener?(listener: (e: MediaQueryListEvent) => void): void;
  removeListener?(listener: (e: MediaQueryListEvent) => void): void;
}

export function subscribeToColorScheme(
  mq: MediaQueryListLike,
  onChange: (prefersDark: boolean) => void,
): () => void {
  const handler = (e: MediaQueryListEvent) => onChange(e.matches);
  if (mq.addEventListener) {
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }
  // Safari < 14 fallback.
  mq.addListener?.(handler);
  return () => mq.removeListener?.(handler);
}

export interface UseThemeReturn {
  theme: Theme;
  setTheme: (next: Theme) => void;
  resolvedTheme: ResolvedTheme;
}

export function useTheme(): UseThemeReturn {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    // URL `?theme=` wins on first paint so the React layer doesn't undo
    // what the FOUC script in apps/web/index.html already pinned.
    const url = readUrlTheme(window.location.search);
    if (url) return url;
    return readStoredTheme(window.localStorage);
  });

  const [prefersDark, setPrefersDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(DARK_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(DARK_MEDIA_QUERY);
    return subscribeToColorScheme(mq, setPrefersDark);
  }, []);

  const resolvedTheme = resolveTheme(theme, prefersDark);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    applyThemeToHtml(document.documentElement, resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    if (typeof window !== 'undefined') {
      writeStoredTheme(window.localStorage, next);
    }
    setThemeState(next);
  }, []);

  return { theme, setTheme, resolvedTheme };
}
