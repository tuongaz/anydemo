import { type ReactNode, useCallback, useReducer } from 'react';
import { componentRegistry } from '../registry/component-registry.tsx';
import type { ComponentSpec } from '../types.ts';

type StateMap = Record<string, unknown>;

type StateAction =
  | { kind: 'set'; path: string; value: unknown }
  | { kind: 'merge'; partial: StateMap };

function reducer(state: StateMap, action: StateAction): StateMap {
  if (action.kind === 'set') return { ...state, [action.path]: action.value };
  return { ...state, ...action.partial };
}

type Ref = {
  $state?: string;
  $action?: string;
  $param?: string;
  $cond?: unknown;
  $then?: unknown;
  $else?: unknown;
};

function isRef(v: unknown): v is Ref {
  if (v === null || typeof v !== 'object') return false;
  return '$state' in v || '$action' in v || '$param' in v || '$cond' in v;
}

type Dispatch = (name: string, payload?: unknown) => void;

function resolveValue(
  v: unknown,
  state: StateMap,
  dispatch: Dispatch,
  actionNames: Set<string>,
): unknown {
  if (!isRef(v)) return v;
  if (typeof v.$state === 'string') return state[v.$state];
  if (typeof v.$action === 'string') {
    const name = v.$action;
    if (!actionNames.has(name)) return undefined;
    return (payload?: unknown) => dispatch(name, payload);
  }
  if ('$cond' in v) {
    const cond = resolveValue(v.$cond, state, dispatch, actionNames);
    return cond
      ? resolveValue(v.$then, state, dispatch, actionNames)
      : resolveValue(v.$else, state, dispatch, actionNames);
  }
  return v;
}

function resolveProps(
  props: Record<string, unknown> | undefined,
  state: StateMap,
  dispatch: Dispatch,
  actionNames: Set<string>,
): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = resolveValue(v, state, dispatch, actionNames);
  }
  return out;
}

export interface ComponentRuntimeProps {
  spec: ComponentSpec;
  nodeId: string;
  /** Base URL for the script-action dispatch endpoint. Defaults to '/api'. */
  apiBaseUrl?: string;
  /** Project slug. Required for script-kind dispatch under the multi-flow route. */
  projectSlug?: string;
  /** Flow slug. Required for script-kind dispatch under the multi-flow route. */
  flowSlug?: string;
}

export function ComponentRuntime({
  spec,
  nodeId,
  apiBaseUrl = '/api',
  projectSlug,
  flowSlug,
}: ComponentRuntimeProps): ReactNode {
  const [state, dispatchState] = useReducer(reducer, spec.state ?? {});
  const actionNames = new Set(Object.keys(spec.actions ?? {}));

  const dispatch = useCallback<Dispatch>(
    async (name, payload) => {
      const action = spec.actions?.[name];
      if (!action) return;
      if (action.kind === 'set') {
        const resolved = resolveSetValue(action.value, payload, state);
        dispatchState({ kind: 'set', path: action.path, value: resolved });
        return;
      }
      if (!projectSlug || !flowSlug) return;
      const url = `${apiBaseUrl}/projects/${encodeURIComponent(projectSlug)}/flows/${encodeURIComponent(flowSlug)}/nodes/${encodeURIComponent(nodeId)}/actions/${encodeURIComponent(name)}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        });
        if (!res.ok) {
          const text = await res.text();
          dispatchState({ kind: 'set', path: `/__errors/${name}`, value: text });
          return;
        }
        const body = (await res.json()) as unknown;
        if (body !== null && typeof body === 'object') {
          dispatchState({ kind: 'merge', partial: body as StateMap });
        }
      } catch (err) {
        dispatchState({
          kind: 'set',
          path: `/__errors/${name}`,
          value: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [spec.actions, projectSlug, flowSlug, apiBaseUrl, nodeId, state],
  );

  return renderElement(spec.root, spec, state, dispatch, actionNames);
}

function resolveSetValue(value: unknown, payload: unknown, state: StateMap): unknown {
  if (!isRef(value)) return value;
  if (typeof value.$param === 'string') {
    if (payload !== null && typeof payload === 'object') {
      return (payload as Record<string, unknown>)[value.$param];
    }
    return undefined;
  }
  if (typeof value.$state === 'string') return state[value.$state];
  return value;
}

function renderElement(
  id: string,
  spec: ComponentSpec,
  state: StateMap,
  dispatch: Dispatch,
  actionNames: Set<string>,
): ReactNode {
  const el = spec.elements[id];
  if (!el) return null;
  const Impl = componentRegistry.components[el.type];
  if (!Impl) return null;
  const props = resolveProps(el.props, state, dispatch, actionNames);
  const childIds = el.children ?? [];
  const children: ReactNode[] = childIds.map((cid) => (
    <ChildSlot key={cid}>{renderElement(cid, spec, state, dispatch, actionNames)}</ChildSlot>
  ));
  return <Impl {...props}>{children.length > 0 ? children : undefined}</Impl>;
}

function ChildSlot({ children }: { children: ReactNode }): ReactNode {
  return children;
}
