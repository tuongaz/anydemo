import { flowPath, matchProjectFlow } from '@/lib/router';
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
 * US-006 will render one mounted `FlowView` per entry on top of the same stack.
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

export const initialStackFromPath = (pathname: string): FlowStackEntry[] => {
  const match = matchProjectFlow(pathname);
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

const pushHistoryState = (depth: number, url: string): void => {
  window.history.pushState({ stackDepth: depth }, '', url);
  window.dispatchEvent(new Event(NAV_EVENT));
};

const replaceHistoryDepth = (depth: number, url: string): void => {
  const prev = (window.history.state ?? null) as HistoryStackState | null;
  window.history.replaceState({ ...(prev ?? {}), stackDepth: depth }, '', url);
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
  const url = target ? flowPath(target.project, target.flow) : '/';
  if (window.location.pathname === url) {
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
 * Idempotent install — call once from App.tsx mount. Seeds the stack from the
 * current URL, stamps `stackDepth` onto the initial history entry, and wires
 * the popstate handler so browser back/forward + the linkflow header back
 * arrow (US-007) share one reconciliation path.
 */
export const ensureFlowNavigation = (): void => {
  if (popstateInstalled) return;
  currentStack = initialStackFromPath(window.location.pathname);
  const prev = (window.history.state ?? null) as HistoryStackState | null;
  if (typeof prev?.stackDepth !== 'number') {
    // We're only stamping stackDepth onto the entry the browser is already on,
    // not navigating.
    window.history.replaceState(
      { ...(prev ?? {}), stackDepth: currentStack.length },
      '',
      window.location.pathname + window.location.search + window.location.hash,
    );
  }
  window.addEventListener('popstate', () => {
    const state = (window.history.state ?? null) as HistoryStackState | null;
    const pathMatch = matchProjectFlow(window.location.pathname);
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
