import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { LiveShareDialog, type LiveShareDialogProps } from '@/components/live-share-dialog';
import type { AuditEntry } from '@/hooks/use-live-share-audit';
import type { ShareStatePeerSummary } from '@/hooks/use-share-state';
import * as React from 'react';

// Hook-shim test pattern (apps/web convention) — synchronous React dispatcher
// so we can call components as functions and walk their returned tree without
// pulling in a DOM. `effectCalls` captures `useEffect` callbacks so tests can
// run them imperatively; the inner cleanups are returned to the caller so
// "closing dialog stops polling" can be asserted via fetch counts.

type EffectCallback = () => undefined | (() => void);

type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: (effect: EffectCallback) => void;
};

type SetterCall = { slot: number; value: unknown };

function renderWithHooks<T>(
  fn: () => T,
  stateOverrides: readonly unknown[] = [],
  setterCalls: SetterCall[] = [],
  effects: EffectCallback[] = [],
): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  let useStateCall = 0;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const idx = useStateCall++;
      const seeded =
        idx < stateOverrides.length && stateOverrides[idx] !== undefined
          ? (stateOverrides[idx] as S)
          : typeof initial === 'function'
            ? (initial as () => S)()
            : initial;
      const setter = (next: S | ((prev: S) => S)) => {
        const resolved = typeof next === 'function' ? (next as (p: S) => S)(seeded) : (next as S);
        setterCalls.push({ slot: idx, value: resolved });
      };
      return [seeded, setter];
    },
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(fn: () => T) => fn(),
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: (effect: EffectCallback) => {
      effects.push(effect);
    },
  };
  try {
    return fn();
  } finally {
    internals.ReactCurrentDispatcher.current = prev;
  }
}

type ReactElementLike = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function isElement(value: unknown): value is ReactElementLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'props' in (value as { props?: unknown })
  );
}

function findAll(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
  acc: ReactElementLike[] = [],
): ReactElementLike[] {
  if (Array.isArray(tree)) {
    for (const child of tree) findAll(child, predicate, acc);
    return acc;
  }
  if (!isElement(tree)) return acc;
  if (predicate(tree)) acc.push(tree);
  const children = tree.props.children;
  if (children === undefined || children === null) return acc;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) findAll(child, predicate, acc);
  return acc;
}

function findAllByTestId(tree: unknown, id: string): ReactElementLike[] {
  return findAll(tree, (el) => (el.props as { 'data-testid'?: string })['data-testid'] === id);
}

function findByTestId(tree: unknown, id: string): ReactElementLike | null {
  return findAllByTestId(tree, id)[0] ?? null;
}

const SAMPLE_PEERS: ShareStatePeerSummary[] = [
  { peerId: 'peer-1', displayName: 'Ada', joinedAt: 1, color: '#10b981' },
  { peerId: 'peer-2', displayName: 'Linus', joinedAt: 2, color: '#3b82f6' },
  { peerId: 'peer-3', displayName: 'Grace', joinedAt: 3, color: '#a855f7' },
];

const NOOP_AUDIT = {
  entries: [] as AuditEntry[],
  refresh: async () => {},
  loading: false,
};

function renderDialog(
  props: Partial<LiveShareDialogProps> = {},
  stateOverrides: readonly unknown[] = [],
  setterCalls: SetterCall[] = [],
  effects: EffectCallback[] = [],
): unknown {
  const merged: LiveShareDialogProps = {
    open: true,
    onOpenChange: () => {},
    peers: SAMPLE_PEERS,
    auditApi: NOOP_AUDIT,
    ...props,
  };
  return renderWithHooks(
    () => (LiveShareDialog as unknown as (p: LiveShareDialogProps) => unknown)(merged),
    stateOverrides,
    setterCalls,
    effects,
  );
}

// State-slot layout (in DECLARATION order across LiveShareDialog body — note
// `useLiveShareAudit` is called first and contributes its own useState slots):
//   0: defaultAudit.entries        (AuditEntry[])
//   1: defaultAudit.loading        (boolean)
//   2: activityOpen                (boolean)
//   3: pendingKick                 (string | null)
//   4: toasts                      (ToastItem[])
const SLOT_ACTIVITY_OPEN = 2;
const SLOT_PENDING_KICK = 3;

const realFetch = globalThis.fetch;
type FetchCall = { url: string; method?: string; body?: string };
function installFetchMock(handler: (call: FetchCall) => { status: number; body?: unknown }): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const call: FetchCall = {
      url,
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    const r = handler(call);
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls };
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('LiveShareDialog', () => {
  it('renders one Kick button per peer (3 peers => 3 buttons)', () => {
    const tree = renderDialog();
    const kicks = findAllByTestId(tree, 'live-share-kick-button');
    expect(kicks.length).toBe(3);
    const peerIds = kicks.map((el) => (el.props as { 'data-peer-id': string })['data-peer-id']);
    expect(peerIds).toEqual(['peer-1', 'peer-2', 'peer-3']);
  });

  it('renders an empty-state row when no peers are connected', () => {
    const tree = renderDialog({ peers: [] });
    const kicks = findAllByTestId(tree, 'live-share-kick-button');
    expect(kicks.length).toBe(0);
    const peerList = findByTestId(tree, 'live-share-peer-list');
    expect(peerList).not.toBeNull();
  });

  it('clicking Kick POSTs /api/share/kick with the peerId in the body', async () => {
    const { calls } = installFetchMock(() => ({ status: 204 }));
    // Pass through to the real default-kick path (no onKick override).
    const tree = renderDialog({ auditApi: NOOP_AUDIT, onKick: undefined });
    const kicks = findAllByTestId(tree, 'live-share-kick-button');
    const ada = kicks.find(
      (el) => (el.props as { 'data-peer-id': string })['data-peer-id'] === 'peer-1',
    );
    if (!ada) throw new Error('peer-1 button missing');
    const onClick = (ada.props as { onClick?: () => Promise<void> | void }).onClick;
    if (!onClick) throw new Error('onClick missing');
    await onClick();
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('/api/share/kick');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toBeDefined();
    const parsed = JSON.parse(calls[0]?.body ?? '{}');
    expect(parsed).toEqual({ peerId: 'peer-1' });
  });

  it('shows a Loader2 spinner on the row whose kick is in-flight', () => {
    // Seed pendingKick = 'peer-2' so Linus's row renders the spinner.
    const overrides: unknown[] = [];
    overrides[SLOT_PENDING_KICK] = 'peer-2';
    const tree = renderDialog({}, overrides);
    const spinners = findAllByTestId(tree, 'live-share-kick-spinner');
    expect(spinners.length).toBe(1);
    // The disabled flag must propagate to the Linus button.
    const linus = findAllByTestId(tree, 'live-share-kick-button').find(
      (el) => (el.props as { 'data-peer-id': string })['data-peer-id'] === 'peer-2',
    );
    expect((linus?.props as { disabled?: boolean }).disabled).toBe(true);
  });

  it('Activity header label tracks audit.entries.length', () => {
    const sampleEntries: AuditEntry[] = [
      { ts: 1700000000000, peerId: 'peer-1', displayName: 'Ada', kind: 'peer-join' },
      { ts: 1700000001000, peerId: 'peer-1', displayName: 'Ada', kind: 'peer-leave' },
    ];
    const tree = renderDialog({
      auditApi: { entries: sampleEntries, refresh: async () => {}, loading: false },
    });
    const toggle = findByTestId(tree, 'live-share-activity-toggle');
    if (!toggle) throw new Error('activity toggle missing');
    const flat = JSON.stringify(toggle);
    expect(flat).toContain('Activity (');
    expect(flat).toContain('2');
  });

  it('expanding Activity renders entries reverse-chrono with formatted HH:mm:ss timestamps', () => {
    // ts1 < ts2 — entries are rendered reverse so ts2 row appears first.
    const ts1 = new Date(2026, 5, 1, 9, 8, 7).getTime(); // 09:08:07
    const ts2 = new Date(2026, 5, 1, 10, 30, 45).getTime(); // 10:30:45
    const entries: AuditEntry[] = [
      { ts: ts1, peerId: 'peer-1', displayName: 'Ada', kind: 'peer-join' },
      {
        ts: ts2,
        peerId: 'peer-1',
        displayName: 'Ada',
        kind: 'rpc-accept',
        op: 'node-move',
        details: { flowId: 'main', nodeId: 'n42' },
      },
    ];
    const overrides: unknown[] = [];
    overrides[SLOT_ACTIVITY_OPEN] = true; // pretend the user already expanded.
    const tree = renderDialog(
      { auditApi: { entries, refresh: async () => {}, loading: false } },
      overrides,
    );
    const rendered = findAllByTestId(tree, 'live-share-activity-entry');
    expect(rendered.length).toBe(2);
    const times = findAllByTestId(tree, 'live-share-activity-time').map((t) => {
      const c = (t.props as { children?: unknown }).children;
      return typeof c === 'string' ? c : Array.isArray(c) ? c.join('') : '';
    });
    expect(times[0]).toBe('10:30:45');
    expect(times[1]).toBe('09:08:07');

    const kinds = findAllByTestId(tree, 'live-share-activity-kind').map((t) => {
      const c = (t.props as { children?: unknown }).children;
      return typeof c === 'string' ? c : Array.isArray(c) ? c.join('') : '';
    });
    expect(kinds[0]).toBe('moved Node n42');
    expect(kinds[1]).toBe('joined');
  });

  it('Activity toggle flips activityOpen state (slot 2)', () => {
    const setterCalls: SetterCall[] = [];
    const tree = renderDialog({}, [], setterCalls);
    const toggle = findByTestId(tree, 'live-share-activity-toggle');
    if (!toggle) throw new Error('activity toggle missing');
    const onClick = (toggle.props as { onClick?: () => void }).onClick;
    if (!onClick) throw new Error('toggle onClick missing');
    setterCalls.length = 0;
    onClick();
    const flips = setterCalls.filter((c) => c.slot === SLOT_ACTIVITY_OPEN);
    expect(flips.length).toBe(1);
    expect(flips[0]?.value).toBe(true);
  });

  it('the dialog forwards open + onOpenChange to the underlying Dialog primitive', () => {
    const observed: boolean[] = [];
    const tree = renderDialog({
      open: true,
      onOpenChange: (v) => {
        observed.push(v);
      },
    });
    // The outermost element is the Dialog primitive.
    if (!isElement(tree)) throw new Error('tree is not an element');
    const props = tree.props as { open?: boolean; onOpenChange?: (v: boolean) => void };
    expect(props.open).toBe(true);
    props.onOpenChange?.(false);
    expect(observed).toEqual([false]);
  });

  describe('audit polling lifecycle', () => {
    it('fetches /api/share/audit?limit=200 on mount when open=true (no auditApi override)', async () => {
      const { calls } = installFetchMock(() => ({
        status: 200,
        body: { entries: [], nextCursor: null },
      }));
      const effects: EffectCallback[] = [];
      // Omit auditApi so the dialog uses the real useLiveShareAudit hook.
      renderDialog({ auditApi: undefined, open: true }, [], [], effects);
      // Run every captured effect. The hook's useEffect kicks off the fetch.
      for (const e of effects) e();
      // The fetch resolves on a microtask — flush so we observe the call.
      await Promise.resolve();
      await Promise.resolve();
      expect(calls.length).toBe(1);
      expect(calls[0]?.url).toBe('/api/share/audit?limit=200');
    });

    it('does NOT fetch when open=false (closed dialog ≡ no polling)', async () => {
      const { calls } = installFetchMock(() => ({
        status: 200,
        body: { entries: [], nextCursor: null },
      }));
      const effects: EffectCallback[] = [];
      renderDialog({ auditApi: undefined, open: false }, [], [], effects);
      for (const e of effects) e();
      await Promise.resolve();
      expect(calls.length).toBe(0);
    });

    it('effect cleanup runs without throwing (clears the polling interval)', () => {
      installFetchMock(() => ({ status: 200, body: { entries: [], nextCursor: null } }));
      const effects: EffectCallback[] = [];
      renderDialog({ auditApi: undefined, open: true }, [], [], effects);
      const cleanups: Array<() => void> = [];
      for (const e of effects) {
        const c = e();
        if (typeof c === 'function') cleanups.push(c);
      }
      // At least one cleanup is the polling interval. Calling it should be
      // safe (no exception).
      expect(() => {
        for (const c of cleanups) c();
      }).not.toThrow();
    });
  });
});
