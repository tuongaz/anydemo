export const DETAIL_PANEL_WIDTH_KEY = 'seeflow:detail-panel-width';

export const DETAIL_PANEL_WIDTH_DEFAULT = 380;
export const DETAIL_PANEL_WIDTH_MIN = 320;
export const DETAIL_PANEL_WIDTH_MAX = 800;

export function clampDetailPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return DETAIL_PANEL_WIDTH_DEFAULT;
  if (value < DETAIL_PANEL_WIDTH_MIN) return DETAIL_PANEL_WIDTH_MIN;
  if (value > DETAIL_PANEL_WIDTH_MAX) return DETAIL_PANEL_WIDTH_MAX;
  return value;
}

export function getStoredDetailPanelWidth(): number {
  if (typeof window === 'undefined') return DETAIL_PANEL_WIDTH_DEFAULT;
  try {
    const raw = window.localStorage.getItem(DETAIL_PANEL_WIDTH_KEY);
    if (raw === null) return DETAIL_PANEL_WIDTH_DEFAULT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DETAIL_PANEL_WIDTH_DEFAULT;
    if (parsed < DETAIL_PANEL_WIDTH_MIN || parsed > DETAIL_PANEL_WIDTH_MAX) {
      return DETAIL_PANEL_WIDTH_DEFAULT;
    }
    return parsed;
  } catch {
    return DETAIL_PANEL_WIDTH_DEFAULT;
  }
}

export function setStoredDetailPanelWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    const clamped = clampDetailPanelWidth(width);
    window.localStorage.setItem(DETAIL_PANEL_WIDTH_KEY, String(clamped));
  } catch {
    // localStorage may be unavailable (private mode, quota, etc.) — non-fatal.
  }
}

export interface ResizeGestureCallbacks {
  onWidth: (next: number) => void;
  onCommit: (final: number) => void;
}

interface ResizeGestureTarget {
  addEventListener: (event: string, cb: (e: { clientX: number }) => void) => void;
  removeEventListener: (event: string, cb: (e: { clientX: number }) => void) => void;
}

/**
 * Start a left-edge horizontal resize gesture. The panel sits on the right, so
 * dragging the handle LEFT widens it. Attaches pointermove/pointerup/cancel
 * listeners to `target` (defaults to `window`); on pointerup it removes the
 * listeners and calls `onCommit` with the final clamped width. The `target`
 * seam is for tests — production passes `window`.
 */
export function startResizeGesture(
  startWidth: number,
  startClientX: number,
  callbacks: ResizeGestureCallbacks,
  target?: ResizeGestureTarget,
): void {
  const win: ResizeGestureTarget | null =
    target ?? (typeof window === 'undefined' ? null : (window as unknown as ResizeGestureTarget));
  if (!win) return;
  let current = clampDetailPanelWidth(startWidth);
  const onMove = (e: { clientX: number }) => {
    current = clampDetailPanelWidth(startWidth + (startClientX - e.clientX));
    callbacks.onWidth(current);
  };
  const onUp = () => {
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
    win.removeEventListener('pointercancel', onUp);
    callbacks.onCommit(current);
  };
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onUp);
  win.addEventListener('pointercancel', onUp);
}
