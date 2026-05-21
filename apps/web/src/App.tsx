import { Header } from '@/components/header';
import { useDemoData } from '@/hooks/use-demo-data';
import { useDemos } from '@/hooks/use-demos';
import { useNodeEvents } from '@/hooks/use-node-events';
import { useNodeRuns } from '@/hooks/use-node-runs';
import { useNodeStatuses } from '@/hooks/use-node-statuses';
import { useRegistryEvents } from '@/hooks/use-registry-events';
import { type FlowReloadPayload, useStudioEvents } from '@/hooks/use-studio-events';
import { type CreateProjectResult, type FlowDetail, playNode, restartFlow } from '@/lib/api';
import { pickInitialDemo, readLastProjectId, writeLastProjectId } from '@/lib/last-project';
import { navigate, usePathname } from '@/lib/router';
import { DemoView } from '@/pages/demo-view';
import { StudioHome } from '@/pages/studio-home';
import { TooltipProvider } from '@seeflow/canvas';
import { useCallback, useEffect } from 'react';

const matchDemoSlug = (pathname: string): string | null => {
  if (!pathname.startsWith('/d/')) return null;
  const slug = pathname.slice('/d/'.length);
  return slug.length > 0 ? decodeURIComponent(slug) : null;
};

export function App() {
  const pathname = usePathname();
  const { demos, refresh: refreshFlows } = useDemos();
  const slug = matchDemoSlug(pathname);

  // External writes (CLI register / unregister) reach us via the global
  // registry SSE channel. The flow list refetches; node-level state stays
  // bound to the open demo and is untouched.
  useRegistryEvents({ onRegistryReload: refreshFlows });

  const currentSummary = slug ? (demos ?? []).find((d) => d.slug === slug) : undefined;
  const flowId = currentSummary?.id ?? null;

  const { detail, loading, refresh: refreshDetail, applyDetail } = useDemoData(flowId);
  const { runs, apply: applyRun } = useNodeRuns(flowId);
  const { events: nodeEvents, apply: applyNodeEvent } = useNodeEvents(flowId);
  const {
    statusByNode,
    apply: applyNodeStatus,
    reset: resetNodeStatuses,
  } = useNodeStatuses(flowId);

  // hello fires on initial connect AND every reconnect. Treat it as a
  // catch-up signal: refetch detail + the demos list, since either could
  // have drifted during the disconnect window. Also reset the per-node
  // status map because the studio kills its status batch on reconnect.
  const onHello = useCallback(() => {
    resetNodeStatuses();
    refreshDetail();
    refreshFlows();
  }, [refreshDetail, refreshFlows, resetNodeStatuses]);

  // Steady-state: the watcher pushes the new merged snapshot inline with
  // each flow:reload event, so we apply it directly. No follow-up GET.
  // The demos list is intentionally NOT refreshed here — a position/edit
  // mutation can't change name/slug, and metadata changes route through
  // their own paths (project create/unregister + hello catch-up).
  //
  // `detail` is deliberately NOT in the dep array: every applyDetail call
  // would otherwise re-create this callback, which would re-run
  // useStudioEvents's effect, close + reopen the EventSource, fire hello,
  // and trigger refreshDetail in a tight loop. filePath is unused on the
  // client and the previous-detail flow fallback is only relevant when an
  // invalid edit lands — rare enough that the closure-snapshot stale-detail
  // is acceptable.
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

  // US-006: `statusByNode` is exposed by the hook so US-007 can render the
  // per-node badge + sidebar status section. It threads through DemoView →
  // DemoCanvas / DetailPanel; the renderers in those files are wired in US-007.

  useStudioEvents(flowId, { onHello, onFlowReload, onEvent });

  const onRestartDemo = useCallback(async (): Promise<void> => {
    if (!flowId) return;
    try {
      await restartFlow(flowId);
    } catch (err) {
      console.error('Failed to restart demo:', err);
    }
  }, [flowId]);

  const onProjectCreated = useCallback(
    (result: CreateProjectResult) => {
      writeLastProjectId(result.id);
      refreshFlows();
    },
    [refreshFlows],
  );

  const onProjectUnregistered = useCallback(
    async (id: string) => {
      await refreshFlows();
      if (flowId === id) navigate('/');
    },
    [refreshFlows, flowId],
  );

  // On '/', skip the picker when there's nothing to pick: jump straight in if
  // only one demo is registered, or if the stored last-used demo still
  // resolves. Otherwise (2+ demos, no recall) StudioHome renders the picker.
  useEffect(() => {
    if (pathname !== '/') return;
    if (demos === null) return;
    const target = pickInitialDemo(demos, readLastProjectId());
    if (target) navigate(`/d/${target.slug}`);
  }, [pathname, demos]);

  // US-001: persist whichever project is currently open so we can reopen it next visit.
  useEffect(() => {
    if (currentSummary) writeLastProjectId(currentSummary.id);
  }, [currentSummary]);

  const onPlayNode = useCallback(
    (nodeId: string) => {
      if (!flowId) return;
      // Fire and forget — the SSE node:* events drive the UI; the synchronous
      // response is currently surfaced through the same SSE stream.
      playNode(flowId, nodeId).catch((err) => {
        applyRun({
          type: 'node:error',
          nodeId,
          message: err instanceof Error ? err.message : String(err),
          ts: Date.now(),
        });
      });
    },
    [flowId, applyRun],
  );

  if (demos === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full w-full flex-col bg-background text-foreground">
        <Header
          demos={demos}
          currentSlug={slug ?? undefined}
          onProjectCreated={onProjectCreated}
          onProjectUnregistered={onProjectUnregistered}
        />
        <main className="min-h-0 flex-1">
          {slug ? (
            <DemoView
              slug={slug}
              demos={demos}
              detail={detail}
              loading={loading}
              runs={runs}
              nodeEvents={nodeEvents}
              statusByNode={statusByNode}
              onPlayNode={onPlayNode}
              onRestartDemo={flowId ? onRestartDemo : undefined}
            />
          ) : (
            <StudioHome demos={demos} />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
