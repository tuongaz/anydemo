import { type BootConfig, readBootConfig } from '@/lib/boot-config';
import { BUILD_BASE, flowPath, matchProjectFlow, stripBase, withBase } from '@/lib/router';
import { useSyncExternalStore } from 'react';

/**
 * US-005: in-memory navigation stack that distinguishes "push" (linkflow body
 * click — appends to the stack so back unwinds with state preserved) from
 * "reset" (every other navigation — clears the stack to a single entry so
 * switching projects/flows doesn't accumulate history). `popBack` is a plain
 * `history.back()` so browser back + the header back arrow share one code path.
 *
 * The stack is mirrored into `history.state.stackDepth` so the popstate handler
 * can rebuild the truncated stack after a back/forward without retaining
 * cross-history references. US-005 keeps the stack at length 1 throughout —
 * US-006 will render one mounted `DemoView` per entry on top of the same stack.
 */

export interface FlowStackEntry {
  project: string;
  flow: string;
  slug: string;
}

export interface NavigateFlowTarget {
  project: string;
  flow: string;
}

interface HistoryStackState {
  stackDepth?: number;
}

const NAV_EVENT = 'seeflow:navigate';
const STACK_EVENT = 'seeflow:flow-stack';

export const toFlowStackEntry = (target: NavigateFlowTarget): FlowStackEntry => ({
  project: target.project,
  flow: target.flow,
  slug: `${target.project}/${target.flow}`,
});

// Boot-injectable so the boot-mode grammar (base root → default flow,
// `/flows/<flow>` → fixed project) flows through matchProjectFlow; production
// calls default to the host-injected boot config.
export const initialStackFromPath = (
  pathname: string,
  boot: BootConfig | null = readBootConfig(),
): FlowStackEntry[] => {
  const match = matchProjectFlow(pathname, boot);
  return match ? [toFlowStackEntry(match)] : [];
};

export const computePushLink = (
  stack: readonly FlowStackEntry[],
  target: NavigateFlowTarget,
): FlowStackEntry[] => [...stack, toFlowStackEntry(target)];

export const computeResetStack = (target: NavigateFlowTarget | null): FlowStackEntry[] =>
  target ? [toFlowStackEntry(target)] : [];

/**
 * Pure popstate transition: given the live stack, the depth recorded in
 * `history.state.stackDepth` for the popped entry, and the parsed pathname,
 * return the truncated stack if it reconciles with the URL. Returns `null`
 * when the URL no longer matches the truncated top — the effectful caller
 * must then `reset(matchProjectFlow(pathname))` to forward-fix.
 */
export const computePopState = (
  stack: readonly FlowStackEntry[],
  depth: number | undefined,
  pathMatch: NavigateFlowTarget | null,
): FlowStackEntry[] | null => {
  if (typeof depth === 'number' && depth >= 0 && depth <= stack.length) {
    const truncated = stack.slice(0, depth);
    const top = truncated.at(-1);
    if (pathMatch) {
      if (top && top.project === pathMatch.project && top.flow === pathMatch.flow) {
        return truncated;
      }
    } else if (truncated.length === 0) {
      return truncated;
    }
  }
  return null;
};

// --- Module-level reactive store ----------------------------------------------

let currentStack: readonly FlowStackEntry[] = [];
let popstateInstalled = false;

const notify = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(STACK_EVENT));
};

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener(STACK_EVENT, listener);
  return () => window.removeEventListener(STACK_EVENT, listener);
};

const getSnapshot = (): readonly FlowStackEntry[] => currentStack;

export const useFlowStack = (): readonly FlowStackEntry[] =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

// Resolve the served base PER CALL (boot base when the host injected one, else
// the build-time base). Re-reading boot here — rather than relying on the
// module-frozen `BASE` from router.ts — decouples the effectful nav functions
// from import order: the host sets `window.__SEEFLOW_BOOT__` before the bundle
// runs in production, so behavior is unchanged there, but it also makes the
// boot path exercisable in tests that install the boot global after import.
// With boot null this falls back to `BUILD_BASE`, i.e. byte-for-byte the
// previous `withBase(url)` default.
const currentBase = (): string => readBootConfig()?.base?.replace(/\/$/, '') ?? BUILD_BASE;

// `url` is always base-RELATIVE (from `flowPath()` / `'/'`); `withBase` puts the
// served base (`''` standalone, `/app` cloud, `/p/<id>` boot) back on before
// touching history.
const pushHistoryState = (depth: number, url: string): void => {
  window.history.pushState({ stackDepth: depth }, '', withBase(url, currentBase()));
  window.dispatchEvent(new Event(NAV_EVENT));
};

const replaceHistoryDepth = (depth: number, url: string): void => {
  const prev = (window.history.state ?? null) as HistoryStackState | null;
  window.history.replaceState(
    { ...(prev ?? {}), stackDepth: depth },
    '',
    withBase(url, currentBase()),
  );
};

export const pushLink = (target: NavigateFlowTarget): void => {
  const next = computePushLink(currentStack, target);
  pushHistoryState(next.length, flowPath(target.project, target.flow));
  currentStack = next;
  notify();
};

export const popBack = (): void => {
  window.history.back();
};

export const reset = (target: NavigateFlowTarget | null): void => {
  const next = computeResetStack(target);
  // Under boot there is no project-picker "home": the base root `/` maps to the
  // project's default flow, so a null target (the no-boot "go home" case) does
  // not arise from in-app navigation. `flowPath`/`stripBase` read boot per call,
  // so this stays correct under both regimes — the null branch is only reachable
  // in the no-boot standalone studio.
  const url = target ? flowPath(target.project, target.flow) : '/';
  // Compare in base-relative space: `url` is base-relative, the live pathname
  // carries the served base.
  if (stripBase(window.location.pathname, currentBase()) === url) {
    replaceHistoryDepth(next.length, url);
  } else {
    pushHistoryState(next.length, url);
  }
  if (currentStack !== next) {
    currentStack = next;
    notify();
  }
};

/**
 * Navigate to a (project, flow), correctly crossing the single-project boot
 * boundary.
 *
 * In a host single-project boot shell (cloud serves the studio under
 * `/p/<id>` with `window.__SEEFLOW_BOOT__`), the project is FIXED to
 * `boot.projectSlug`: `flowPath` drops the `/projects/<slug>` segment, so an
 * in-SPA `reset` to a DIFFERENT project silently stays on the booted one. That
 * is the "create/switch project does nothing" bug — the new/switched project
 * never opens, and the studio then refetches `/api/flows` looking for a slug it
 * can never reach in this shell. Escape the single-project boot with a
 * full-page load into the host's MULTI-project studio (`BUILD_BASE`, e.g.
 * `/app`), where the project IS part of the URL and every project resolves.
 *
 * No boot, or the same project as boot → a plain in-SPA `reset` (unchanged for
 * the standalone studio and the cloud `/app` multi-project shell, where every
 * project is already addressable).
 */
export const navigateToFlow = (target: NavigateFlowTarget): void => {
  const boot = readBootConfig();
  if (boot && target.project !== boot.projectSlug) {
    // `flowPath(…, null)` forces the multi-project grammar (`/projects/<p>/flows/<f>`);
    // `withBase(…, BUILD_BASE)` puts the build-time base (`/app`) back on.
    window.location.assign(withBase(flowPath(target.project, target.flow, null), BUILD_BASE));
    return;
  }
  reset(target);
};

/**
 * Idempotent install — call once from App.tsx mount. Seeds the stack from the
 * current URL, stamps `stackDepth` onto the initial history entry, and wires
 * the popstate handler so browser back/forward + the linkflow header back
 * arrow (US-007) share one reconciliation path.
 */
export const ensureFlowNavigation = (): void => {
  if (popstateInstalled) return;
  // Seed/match in base-relative space; the matchers don't know about the base.
  currentStack = initialStackFromPath(stripBase(window.location.pathname, currentBase()));
  const prev = (window.history.state ?? null) as HistoryStackState | null;
  if (typeof prev?.stackDepth !== 'number') {
    // Keep the full (base-carrying) pathname here — we're only stamping
    // stackDepth onto the entry the browser is already on, not navigating.
    window.history.replaceState(
      { ...(prev ?? {}), stackDepth: currentStack.length },
      '',
      window.location.pathname + window.location.search + window.location.hash,
    );
  }
  window.addEventListener('popstate', () => {
    const state = (window.history.state ?? null) as HistoryStackState | null;
    // Boot semantics: `matchProjectFlow('/', boot)` is NON-null (the base root
    // resolves to the project's default flow), so back-navigating to the base
    // root reconciles to that default-flow entry — the empty-stack "home" state
    // (reachable only in the no-boot standalone studio, where `/` is the project
    // picker) is intentionally unreachable under boot. This is intended, not a
    // bug: there is no project-picker home when the project is fixed by boot.
    const pathMatch = matchProjectFlow(stripBase(window.location.pathname, currentBase()));
    const next = computePopState(currentStack, state?.stackDepth, pathMatch);
    if (next !== null) {
      if (currentStack !== next) {
        currentStack = next;
        notify();
      }
      return;
    }
    reset(pathMatch);
  });
  popstateInstalled = true;
};

// --- Test seams ---------------------------------------------------------------

export const __setFlowStackForTests = (next: readonly FlowStackEntry[]): void => {
  currentStack = next;
};

export const __getFlowStackForTests = (): readonly FlowStackEntry[] => currentStack;

// Clears the install-once guard so a test can re-run `ensureFlowNavigation`
// against a fresh fake window (the production guard is module-scoped).
export const __resetFlowNavigationForTests = (): void => {
  popstateInstalled = false;
};
