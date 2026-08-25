import { useFlowData } from '@/hooks/use-flow-data';
import { type FlowStackEntry, useFlowStack } from '@/hooks/use-navigate-flow';
import { type FlowReloadPayload, useStudioEvents } from '@/hooks/use-studio-events';
import type { FlowDetail, FlowSummary } from '@/lib/api';
import { FlowView } from '@/pages/flow-view';
import type { SeeflowCanvasHandle } from '@seeflow/canvas';
import { type RefObject, useCallback, useRef, useState } from 'react';
import type React from 'react';

/**
 * US-006: render one `FlowView` per stack entry, toggling visibility with
 * `display:none` instead of unmounting. Each entry keys the wrapper `<div>`
 * on `entry.slug` so duplicate flows (A→B→A) get independent mounts; hidden
 * FlowViews keep React state, viewport, undo history, and their own SSE
 * connections alive because each entry's data hooks live in
 * `StackedFlowView` rather than at the App level.
 *
 * The list (`FlowStackList`) is split out as a presentational component so
 * the App-level smoke test can hand-build a two-entry stack without dragging
 * in `useFlowStack`, useFlowData, the studio EventSource, or any of the
 * other FlowView-internal machinery.
 */

export interface FlowStackPaneProps {
  flows: FlowSummary[];
  refreshFlows: () => Promise<void> | void;
  /**
   * App-owned canvas imperative handle (the header's Share menu drives it).
   * Forwarded only to the top stack entry's FlowView — hidden mounts use a
   * local throwaway ref so a flow under the top can't overwrite App's ref.
   */
  canvasRef: RefObject<SeeflowCanvasHandle>;
}

export interface FlowStackListProps {
  stack: readonly FlowStackEntry[];
  renderEntry: (entry: FlowStackEntry, isTop: boolean) => React.ReactNode;
}

const containerStyle = (isTop: boolean): React.CSSProperties => ({
  display: isTop ? 'block' : 'none',
  height: '100%',
});

export function FlowStackList({ stack, renderEntry }: FlowStackListProps) {
  return (
    <>
      {stack.map((entry, idx) => {
        const isTop = idx === stack.length - 1;
        return (
          <div
            key={entry.slug}
            data-flow-stack-entry={entry.slug}
            data-flow-stack-top={isTop ? 'true' : 'false'}
            style={containerStyle(isTop)}
          >
            {renderEntry(entry, isTop)}
          </div>
        );
      })}
    </>
  );
}

export function FlowStackPane({ flows, refreshFlows, canvasRef }: FlowStackPaneProps) {
  const stack = useFlowStack();
  return (
    <FlowStackList
      stack={stack}
      renderEntry={(entry, isTop) => (
        <StackedFlowView
          entry={entry}
          flows={flows}
          refreshFlows={refreshFlows}
          canvasRef={isTop ? canvasRef : undefined}
        />
      )}
    />
  );
}

interface StackedFlowViewProps {
  entry: FlowStackEntry;
  flows: FlowSummary[];
  refreshFlows: () => Promise<void> | void;
  canvasRef?: RefObject<SeeflowCanvasHandle>;
}

/**
 * One mounted FlowView with its own data fetch + SSE connection. Keyed by
 * `entry.slug` upstream — once mounted, its (project, flow) is fixed for
 * the wrapper's lifetime, so the internal hooks (which depend on those
 * props) never see a midflight switch.
 */
export function StackedFlowView({ entry, flows, refreshFlows, canvasRef }: StackedFlowViewProps) {
  const { project, flow, slug } = entry;
  const currentSummary = flows.find((d) => d.slug === slug);
  const flowId = currentSummary?.id ?? null;
  // Non-top entries don't get App's ref — they take a throwaway local one so
  // FlowView's `canvasRef` prop is always non-null.
  const localCanvasRef = useRef<SeeflowCanvasHandle>(null);
  const effectiveCanvasRef = canvasRef ?? localCanvasRef;

  const { detail, loading, refresh: refreshDetail, applyDetail } = useFlowData(project, flow);
  // Monotonic counter bumped ONLY when the watcher reports a real
  // `flow:reload`. FlowView's undo-history stale-clear keys off this so a
  // routine SSE reconnect catch-up doesn't wipe a populated undo stack.
  const [externalReloadSignal, setExternalReloadSignal] = useState(0);

  const onHello = useCallback(() => {
    refreshDetail();
    refreshFlows();
  }, [refreshDetail, refreshFlows]);

  const onFlowReload = useCallback(
    (payload: FlowReloadPayload) => {
      if (!flowId || !currentSummary) return;
      const base = {
        id: flowId,
        slug: currentSummary.slug,
        filePath: '',
      };
      const next: FlowDetail = payload.valid
        ? {
            ...base,
            name: payload.flow.name ?? currentSummary.name,
            flow: payload.flow,
            valid: true,
            error: null,
          }
        : {
            ...base,
            name: currentSummary.name,
            flow: null,
            valid: false,
            error: payload.error,
          };
      applyDetail(next);
      setExternalReloadSignal((n) => n + 1);
    },
    [flowId, currentSummary, applyDetail],
  );

  useStudioEvents(flowId, { onHello, onFlowReload });

  return (
    <FlowView
      project={project}
      flow={flow}
      slug={slug}
      flows={flows}
      detail={detail}
      loading={loading}
      externalReloadSignal={externalReloadSignal}
      refreshFlows={refreshFlows}
      applyDetail={applyDetail}
      canvasRef={effectiveCanvasRef}
    />
  );
}
