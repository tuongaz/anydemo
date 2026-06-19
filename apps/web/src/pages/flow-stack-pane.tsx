import { useDemoData } from '@/hooks/use-demo-data';
import { type FlowStackEntry, useFlowStack } from '@/hooks/use-navigate-flow';
import { useNodeEvents } from '@/hooks/use-node-events';
import { useNodeRuns } from '@/hooks/use-node-runs';
import { useNodeStatuses } from '@/hooks/use-node-statuses';
import { type FlowReloadPayload, useStudioEvents } from '@/hooks/use-studio-events';
import { type FlowDetail, type FlowSummary, playFlowNode } from '@/lib/api';
import { DemoView } from '@/pages/demo-view';
import type { SeeflowCanvasHandle } from '@seeflow/canvas';
import { type RefObject, useCallback, useRef, useState } from 'react';
import type React from 'react';

/**
 * US-006: render one `DemoView` per stack entry, toggling visibility with
 * `display:none` instead of unmounting. Each entry keys the wrapper `<div>`
 * on `entry.slug` so duplicate flows (A→B→A) get independent mounts; hidden
 * DemoViews keep React state, viewport, undo history, and their own SSE
 * connections alive because each entry's data hooks live in
 * `DemoStackEntry` rather than at the App level.
 *
 * The list (`FlowStackList`) is split out as a presentational component so
 * the App-level smoke test can hand-build a two-entry stack without dragging
 * in `useFlowStack`, useDemoData, the studio EventSource, or any of the
 * other DemoView-internal machinery.
 */

export interface FlowStackPaneProps {
  demos: FlowSummary[];
  refreshFlows: () => Promise<void> | void;
  /**
   * App-owned canvas imperative handle (Share menu + ExportDialog drive it).
   * Forwarded only to the top stack entry's DemoView — hidden mounts use a
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

export function FlowStackPane({ demos, refreshFlows, canvasRef }: FlowStackPaneProps) {
  const stack = useFlowStack();
  return (
    <FlowStackList
      stack={stack}
      renderEntry={(entry, isTop) => (
        <DemoStackEntry
          entry={entry}
          demos={demos}
          refreshFlows={refreshFlows}
          canvasRef={isTop ? canvasRef : undefined}
        />
      )}
    />
  );
}

interface DemoStackEntryProps {
  entry: FlowStackEntry;
  demos: FlowSummary[];
  refreshFlows: () => Promise<void> | void;
  canvasRef?: RefObject<SeeflowCanvasHandle>;
}

/**
 * One mounted DemoView with its own data fetch + SSE connection. Keyed by
 * `entry.slug` upstream — once mounted, its (project, flow) is fixed for
 * the wrapper's lifetime, so the internal hooks (which depend on those
 * props) never see a midflight switch.
 */
export function DemoStackEntry({ entry, demos, refreshFlows, canvasRef }: DemoStackEntryProps) {
  const { project, flow, slug } = entry;
  const currentSummary = demos.find((d) => d.slug === slug);
  const flowId = currentSummary?.id ?? null;
  // Non-top entries don't get App's ref — they take a throwaway local one so
  // DemoView's `canvasRef` prop is always non-null.
  const localCanvasRef = useRef<SeeflowCanvasHandle>(null);
  const effectiveCanvasRef = canvasRef ?? localCanvasRef;

  const { detail, loading, refresh: refreshDetail, applyDetail } = useDemoData(project, flow);
  // Monotonic counter bumped ONLY when the watcher reports a real
  // `flow:reload`. DemoView's undo-history stale-clear keys off this so a
  // routine SSE reconnect catch-up doesn't wipe a populated undo stack.
  const [externalReloadSignal, setExternalReloadSignal] = useState(0);
  const { runs, apply: applyRun } = useNodeRuns(flowId);
  const { events: nodeEvents, apply: applyNodeEvent } = useNodeEvents(flowId);
  const {
    statusByNode,
    apply: applyNodeStatus,
    reset: resetNodeStatuses,
  } = useNodeStatuses(flowId);

  const onHello = useCallback(() => {
    resetNodeStatuses();
    refreshDetail();
    refreshFlows();
  }, [refreshDetail, refreshFlows, resetNodeStatuses]);

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

  const onEvent = useCallback(
    (event: Parameters<typeof applyRun>[0]) => {
      applyRun(event);
      applyNodeEvent(event);
      applyNodeStatus(event);
    },
    [applyRun, applyNodeEvent, applyNodeStatus],
  );

  useStudioEvents(flowId, { onHello, onFlowReload, onEvent });

  const onPlayNode = useCallback(
    (nodeId: string) => {
      playFlowNode(project, flow, nodeId).catch((err) => {
        applyRun({
          type: 'node:error',
          nodeId,
          message: err instanceof Error ? err.message : String(err),
          ts: Date.now(),
        });
      });
    },
    [project, flow, applyRun],
  );

  return (
    <DemoView
      project={project}
      flow={flow}
      slug={slug}
      demos={demos}
      detail={detail}
      loading={loading}
      runs={runs}
      nodeEvents={nodeEvents}
      statusByNode={statusByNode}
      externalReloadSignal={externalReloadSignal}
      onPlayNode={onPlayNode}
      refreshFlows={refreshFlows}
      applyDetail={applyDetail}
      canvasRef={effectiveCanvasRef}
    />
  );
}
