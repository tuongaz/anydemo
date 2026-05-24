import { describe, expect, it } from 'bun:test';
import {
  DARK_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  applyThemeToHtml,
  isTheme,
  readStoredTheme,
  readUrlTheme,
  resolveTheme,
  subscribeToColorScheme,
  writeStoredTheme,
} from '@/hooks/use-theme';

// In-memory Storage stand-in so the test stays portable across runtimes.
// Bun's `bun test` does not ship a localStorage global by default.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('constants', () => {
  it('THEME_STORAGE_KEY is the documented localStorage key', () => {
    expect(THEME_STORAGE_KEY).toBe('seeflow:theme');
  });

  it('DARK_MEDIA_QUERY matches the CSS media query the FOUC script will read', () => {
    expect(DARK_MEDIA_QUERY).toBe('(prefers-color-scheme: dark)');
  });
});

describe('isTheme', () => {
  it('accepts the three documented values', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('system')).toBe(true);
  });

  it('rejects anything else (defensive against bad localStorage entries)', () => {
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme('')).toBe(false);
    expect(isTheme('Light')).toBe(false);
    expect(isTheme('DARK')).toBe(false);
    expect(isTheme(42)).toBe(false);
    expect(isTheme({})).toBe(false);
  });
});

describe('readStoredTheme / writeStoredTheme — localStorage roundtrip', () => {
  it('round-trips "dark" through storage', () => {
    const storage = new MemoryStorage();
    writeStoredTheme(storage, 'dark');
    expect(readStoredTheme(storage)).toBe('dark');
  });

  it('round-trips "light" through storage', () => {
    const storage = new MemoryStorage();
    writeStoredTheme(storage, 'light');
    expect(readStoredTheme(storage)).toBe('light');
  });

  it('round-trips "system" through storage', () => {
    const storage = new MemoryStorage();
    writeStoredTheme(storage, 'system');
    expect(readStoredTheme(storage)).toBe('system');
  });

  it('defaults to "system" when the key is absent', () => {
    expect(readStoredTheme(new MemoryStorage())).toBe('system');
  });

  it('defaults to "system" when the stored value is malformed', () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_STORAGE_KEY, 'midnight');
    expect(readStoredTheme(storage)).toBe('system');
  });

  it('survives a storage that throws on read (private-browsing mode)', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readStoredTheme(broken)).toBe('system');
  });

  it('survives a storage that throws on write (quota exceeded)', () => {
    const broken = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => writeStoredTheme(broken, 'dark')).not.toThrow();
  });
});

describe('readUrlTheme — ?theme= URL param (US-010 viewer / embed iframe)', () => {
  it('returns "light" for ?theme=light', () => {
    expect(readUrlTheme('?theme=light')).toBe('light');
  });

  it('returns "dark" for ?theme=dark', () => {
    expect(readUrlTheme('?theme=dark')).toBe('dark');
  });

  it('returns "light" for an unknown ?theme= value (matches new package default)', () => {
    expect(readUrlTheme('?theme=midnight')).toBe('light');
  });

  it('returns "light" for an empty ?theme= value', () => {
    expect(readUrlTheme('?theme=')).toBe('light');
  });

  it('returns null when no theme param is present (falls through to studio chain)', () => {
    expect(readUrlTheme('')).toBe(null);
    expect(readUrlTheme('?foo=bar')).toBe(null);
  });

  it('survives a search string that throws inside URLSearchParams', () => {
    // URLSearchParams accepts most strings without throwing, so the catch
    // branch is mostly defensive against future input shapes. Smoke-test that
    // the function never throws on stress input.
    expect(() => readUrlTheme('?theme=light&theme=dark&%E0')).not.toThrow();
  });

  it('honors the first ?theme= occurrence on a multi-value URL', () => {
    expect(readUrlTheme('?theme=light&theme=dark')).toBe('light');
    expect(readUrlTheme('?theme=dark&theme=light')).toBe('dark');
  });

  it('is case-sensitive (only accepts canonical lowercase)', () => {
    expect(readUrlTheme('?theme=Light')).toBe('light');
    expect(readUrlTheme('?theme=DARK')).toBe('light');
  });
});

describe('resolveTheme — "system" → matchMedia resolution', () => {
  it('returns "light" unchanged regardless of OS preference', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('returns "dark" unchanged regardless of OS preference', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('resolves "system" to "dark" when prefers-color-scheme: dark matches', () => {
    expect(resolveTheme('system', true)).toBe('dark');
  });

  it('resolves "system" to "light" when prefers-color-scheme: dark does not match', () => {
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('applyThemeToHtml — <html> class application', () => {
  function fakeHtml() {
    const classes = new Set<string>();
    return {
      classes,
      classList: {
        add: (c: string) => {
          classes.add(c);
        },
        remove: (c: string) => {
          classes.delete(c);
        },
      },
    };
  }

  it('adds "dark" and strips "light" when resolved is dark', () => {
    const html = fakeHtml();
    html.classList.add('light');
    applyThemeToHtml({ classList: html.classList }, 'dark');
    expect(html.classes.has('dark')).toBe(true);
    expect(html.classes.has('light')).toBe(false);
  });

  it('adds "light" and strips "dark" when resolved is light', () => {
    const html = fakeHtml();
    html.classList.add('dark');
    applyThemeToHtml({ classList: html.classList }, 'light');
    expect(html.classes.has('light')).toBe(true);
    expect(html.classes.has('dark')).toBe(false);
  });

  it('is idempotent (re-applying the same theme does not toggle classes)', () => {
    const html = fakeHtml();
    applyThemeToHtml({ classList: html.classList }, 'dark');
    applyThemeToHtml({ classList: html.classList }, 'dark');
    expect(html.classes.has('dark')).toBe(true);
    expect(html.classes.has('light')).toBe(false);
  });
});

describe('subscribeToColorScheme — OS preference change subscription', () => {
  type Handler = (e: MediaQueryListEvent) => void;

  function makeMq() {
    const listeners = new Set<Handler>();
    return {
      mq: {
        matches: false,
        addEventListener: (_type: 'change', h: Handler) => {
          listeners.add(h);
        },
        removeEventListener: (_type: 'change', h: Handler) => {
          listeners.delete(h);
        },
      },
      fire(matches: boolean) {
        for (const h of listeners) h({ matches } as MediaQueryListEvent);
      },
      get count() {
        return listeners.size;
      },
    };
  }

  it('registers a change listener and propagates OS theme flips', () => {
    const m = makeMq();
    const changes: boolean[] = [];
    subscribeToColorScheme(m.mq, (v) => changes.push(v));
    expect(m.count).toBe(1);
    m.fire(true);
    m.fire(false);
    m.fire(true);
    expect(changes).toEqual([true, false, true]);
  });

  it('returns a cleanup function that removes the listener', () => {
    const m = makeMq();
    const off = subscribeToColorScheme(m.mq, () => {});
    expect(m.count).toBe(1);
    off();
    expect(m.count).toBe(0);
  });

  it('falls back to addListener/removeListener for Safari < 14', () => {
    const listeners = new Set<Handler>();
    const legacyMq = {
      matches: false,
      addListener: (h: Handler) => {
        listeners.add(h);
      },
      removeListener: (h: Handler) => {
        listeners.delete(h);
      },
    };
    const changes: boolean[] = [];
    const off = subscribeToColorScheme(legacyMq, (v) => changes.push(v));
    expect(listeners.size).toBe(1);
    const [handler] = listeners;
    handler?.({ matches: true } as MediaQueryListEvent);
    expect(changes).toEqual([true]);
    off();
    expect(listeners.size).toBe(0);
  });
});
