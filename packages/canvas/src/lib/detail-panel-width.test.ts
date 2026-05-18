import { beforeEach, describe, expect, it, mock } from 'bun:test';

const memStore = new Map<string, string>();
const mockLocalStorage = {
  getItem: (k: string): string | null => memStore.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    memStore.set(k, v);
  },
  removeItem: (k: string): void => {
    memStore.delete(k);
  },
};

(globalThis as { window?: { localStorage: typeof mockLocalStorage } }).window = {
  localStorage: mockLocalStorage,
};

const {
  DETAIL_PANEL_WIDTH_DEFAULT,
  DETAIL_PANEL_WIDTH_KEY,
  DETAIL_PANEL_WIDTH_MAX,
  DETAIL_PANEL_WIDTH_MIN,
  clampDetailPanelWidth,
  getStoredDetailPanelWidth,
  setStoredDetailPanelWidth,
  startResizeGesture,
} = await import('./detail-panel-width');

beforeEach(() => {
  memStore.clear();
});

describe('clampDetailPanelWidth', () => {
  it('passes through values inside [MIN, MAX]', () => {
    expect(clampDetailPanelWidth(380)).toBe(380);
    expect(clampDetailPanelWidth(DETAIL_PANEL_WIDTH_MIN)).toBe(DETAIL_PANEL_WIDTH_MIN);
    expect(clampDetailPanelWidth(DETAIL_PANEL_WIDTH_MAX)).toBe(DETAIL_PANEL_WIDTH_MAX);
  });

  it('clamps below MIN to MIN', () => {
    expect(clampDetailPanelWidth(100)).toBe(DETAIL_PANEL_WIDTH_MIN);
  });

  it('clamps above MAX to MAX', () => {
    expect(clampDetailPanelWidth(9999)).toBe(DETAIL_PANEL_WIDTH_MAX);
  });

  it('returns default for non-finite values', () => {
    expect(clampDetailPanelWidth(Number.NaN)).toBe(DETAIL_PANEL_WIDTH_DEFAULT);
    expect(clampDetailPanelWidth(Number.POSITIVE_INFINITY)).toBe(DETAIL_PANEL_WIDTH_DEFAULT);
  });
});

describe('getStoredDetailPanelWidth', () => {
  it('returns the default when the key is missing', () => {
    expect(getStoredDetailPanelWidth()).toBe(DETAIL_PANEL_WIDTH_DEFAULT);
  });

  it('returns the stored numeric value when within [MIN, MAX]', () => {
    memStore.set(DETAIL_PANEL_WIDTH_KEY, '480');
    expect(getStoredDetailPanelWidth()).toBe(480);
  });

  it('returns the default when the stored value is not a finite number', () => {
    memStore.set(DETAIL_PANEL_WIDTH_KEY, 'not-a-number');
    expect(getStoredDetailPanelWidth()).toBe(DETAIL_PANEL_WIDTH_DEFAULT);
  });

  it('returns the default when the stored value is below MIN', () => {
    memStore.set(DETAIL_PANEL_WIDTH_KEY, '100');
    expect(getStoredDetailPanelWidth()).toBe(DETAIL_PANEL_WIDTH_DEFAULT);
  });

  it('returns the default when the stored value is above MAX', () => {
    memStore.set(DETAIL_PANEL_WIDTH_KEY, '9999');
    expect(getStoredDetailPanelWidth()).toBe(DETAIL_PANEL_WIDTH_DEFAULT);
  });
});

describe('setStoredDetailPanelWidth', () => {
  it('writes the value as a string', () => {
    setStoredDetailPanelWidth(500);
    expect(memStore.get(DETAIL_PANEL_WIDTH_KEY)).toBe('500');
  });

  it('clamps to MIN before writing', () => {
    setStoredDetailPanelWidth(50);
    expect(memStore.get(DETAIL_PANEL_WIDTH_KEY)).toBe(String(DETAIL_PANEL_WIDTH_MIN));
  });

  it('clamps to MAX before writing', () => {
    setStoredDetailPanelWidth(9999);
    expect(memStore.get(DETAIL_PANEL_WIDTH_KEY)).toBe(String(DETAIL_PANEL_WIDTH_MAX));
  });

  it('round-trips through getStoredDetailPanelWidth', () => {
    setStoredDetailPanelWidth(560);
    expect(getStoredDetailPanelWidth()).toBe(560);
  });
});

describe('startResizeGesture', () => {
  type Listener = (e: { clientX: number }) => void;

  function makeTarget() {
    const listeners = new Map<string, Listener[]>();
    return {
      target: {
        addEventListener: (event: string, cb: Listener) => {
          const arr = listeners.get(event) ?? [];
          arr.push(cb);
          listeners.set(event, arr);
        },
        removeEventListener: (event: string, cb: Listener) => {
          const arr = listeners.get(event) ?? [];
          listeners.set(
            event,
            arr.filter((c) => c !== cb),
          );
        },
      },
      fire: (event: string, e: { clientX: number }) => {
        for (const cb of listeners.get(event) ?? []) cb(e);
      },
      count: (event: string) => (listeners.get(event) ?? []).length,
    };
  }

  it('attaches pointermove/pointerup/pointercancel listeners on start', () => {
    const t = makeTarget();
    startResizeGesture(380, 1000, { onWidth: () => {}, onCommit: () => {} }, t.target);
    expect(t.count('pointermove')).toBe(1);
    expect(t.count('pointerup')).toBe(1);
    expect(t.count('pointercancel')).toBe(1);
  });

  it('widens the panel when dragging LEFT (decreasing clientX)', () => {
    const t = makeTarget();
    const onWidth = mock((_w: number) => {});
    startResizeGesture(380, 1000, { onWidth, onCommit: () => {} }, t.target);
    // Drag the handle 100 px to the LEFT — panel widens by 100.
    t.fire('pointermove', { clientX: 900 });
    expect(onWidth).toHaveBeenCalledTimes(1);
    expect(onWidth).toHaveBeenLastCalledWith(480);
    // Drag a further 100 px left from origin (now 200 total).
    t.fire('pointermove', { clientX: 800 });
    expect(onWidth).toHaveBeenLastCalledWith(580);
  });

  it('narrows the panel when dragging RIGHT (increasing clientX)', () => {
    const t = makeTarget();
    const onWidth = mock((_w: number) => {});
    startResizeGesture(500, 1000, { onWidth, onCommit: () => {} }, t.target);
    t.fire('pointermove', { clientX: 1100 });
    expect(onWidth).toHaveBeenLastCalledWith(400);
  });

  it('clamps the width during drag (MIN / MAX)', () => {
    const t = makeTarget();
    const onWidth = mock((_w: number) => {});
    startResizeGesture(380, 1000, { onWidth, onCommit: () => {} }, t.target);
    // Far-left drag would push past MAX.
    t.fire('pointermove', { clientX: -5000 });
    expect(onWidth).toHaveBeenLastCalledWith(DETAIL_PANEL_WIDTH_MAX);
    // Far-right drag would push below MIN.
    t.fire('pointermove', { clientX: 5000 });
    expect(onWidth).toHaveBeenLastCalledWith(DETAIL_PANEL_WIDTH_MIN);
  });

  it('removes all listeners and fires onCommit with the final width on pointerup', () => {
    const t = makeTarget();
    const onWidth = mock((_w: number) => {});
    const onCommit = mock((_w: number) => {});
    startResizeGesture(380, 1000, { onWidth, onCommit }, t.target);
    t.fire('pointermove', { clientX: 800 }); // → 580
    t.fire('pointerup', { clientX: 800 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(580);
    expect(t.count('pointermove')).toBe(0);
    expect(t.count('pointerup')).toBe(0);
    expect(t.count('pointercancel')).toBe(0);
  });

  it('treats pointercancel like pointerup (final commit + cleanup)', () => {
    const t = makeTarget();
    const onCommit = mock((_w: number) => {});
    startResizeGesture(380, 1000, { onWidth: () => {}, onCommit }, t.target);
    t.fire('pointermove', { clientX: 950 }); // → 430
    t.fire('pointercancel', { clientX: 950 });
    expect(onCommit).toHaveBeenLastCalledWith(430);
    expect(t.count('pointermove')).toBe(0);
  });

  it('persists to localStorage when wired via setStoredDetailPanelWidth as onCommit', () => {
    const t = makeTarget();
    startResizeGesture(
      380,
      1000,
      { onWidth: () => {}, onCommit: (w) => setStoredDetailPanelWidth(w) },
      t.target,
    );
    t.fire('pointermove', { clientX: 800 }); // → 580
    t.fire('pointerup', { clientX: 800 });
    expect(memStore.get(DETAIL_PANEL_WIDTH_KEY)).toBe('580');
  });
});
