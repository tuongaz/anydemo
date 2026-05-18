/**
 * Tiny trailing-edge debouncer. Calling `schedule(fn)` arms a timer; further
 * calls within the window replace the pending callback. `flush()` runs the
 * pending callback synchronously; `cancel()` drops it without running. Uses
 * injectable scheduling primitives so tests can drive it with fake timers
 * without monkey-patching globals.
 */
export interface Debouncer {
  /** Arm or rearm the trailing-edge timer with the latest callback. */
  schedule: (run: () => void) => void;
  /** Run the pending callback immediately (no-op if none pending). */
  flush: () => void;
  /** Drop the pending callback without running it. */
  cancel: () => void;
  /** True while a callback is pending. */
  readonly pending: boolean;
}

export interface DebouncerOptions {
  /** Defaults to globalThis.setTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Defaults to globalThis.clearTimeout. */
  clearTimer?: (handle: unknown) => void;
}

export const createDebouncer = (delayMs: number, options: DebouncerOptions = {}): Debouncer => {
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown);
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    });

  let handle: unknown = null;
  let nextRun: (() => void) | null = null;

  const cancel = () => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
    nextRun = null;
  };

  const flush = () => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
    const run = nextRun;
    nextRun = null;
    if (run) run();
  };

  const schedule = (run: () => void) => {
    if (handle !== null) clearTimer(handle);
    nextRun = run;
    handle = setTimer(() => {
      handle = null;
      const pending = nextRun;
      nextRun = null;
      if (pending) pending();
    }, delayMs);
  };

  return {
    schedule,
    flush,
    cancel,
    get pending() {
      return handle !== null;
    },
  };
};
