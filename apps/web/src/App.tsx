import { ExportDialog } from '@/components/export-dialog';
import { Header, type HeaderShareCallbacks } from '@/components/header';
import { useDemoData } from '@/hooks/use-demo-data';
import { useDemos } from '@/hooks/use-demos';
import { useNodeEvents } from '@/hooks/use-node-events';
import { useNodeRuns } from '@/hooks/use-node-runs';
import { useNodeStatuses } from '@/hooks/use-node-statuses';
import { useProjectFlows } from '@/hooks/use-project-flows';
import { useProjects } from '@/hooks/use-projects';
import { useRegistryEvents } from '@/hooks/use-registry-events';
import { type FlowReloadPayload, useStudioEvents } from '@/hooks/use-studio-events';
import { type CreateProjectResult, type FlowDetail, playFlowNode } from '@/lib/api';
import { pickInitialFlow, readLastFlow, writeLastFlow } from '@/lib/last-flow';
import { pickInitialDemo, readLastProjectId, writeLastProjectId } from '@/lib/last-project';
import {
  flowPath,
  flowPathFromSlug,
  matchProjectAlone,
  matchProjectFlow,
  navigate,
  usePathname,
} from '@/lib/router';
import { DemoView } from '@/pages/demo-view';
import { StudioHome } from '@/pages/studio-home';
import { type SeeflowCanvasHandle, TooltipProvider } from '@seeflow/canvas';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function App() {
  const pathname = usePathname();
  const { demos, refresh: refreshFlows } = useDemos();
  // US-036: the top-right ProjectSwitcher is sourced from `GET /api/projects`
  // so a multi-flow project surfaces once, not once per flow. The legacy
  // `demos` list (FlowSummary[]) still backs the canvas page resolution, the
  // `/` landing picker, and SSE-driven detail caches.
  const { projects, refresh: refreshProjects, unregisterProject } = useProjects();
  // US-010: canvas page now lives at `/projects/:project/flows/:flow`. The
  // legacy `/d/<slug>` shape is gone — older bookmarks land on StudioHome and
  // the auto-pick effect rewrites them to the new URL if a demo resolves.
  const match = matchProjectFlow(pathname);
  const project = match?.project ?? null;
  const flow = match?.flow ?? null;

  // US-026: when the URL is `/projects/:project` with no flow segment we
  // redirect to the user's last-opened flow (per-project localStorage) or
  // the project's default. `useProjectFlows(projectOnly)` parks in idle when
  // no redirect is needed.
  const projectOnly = matchProjectAlone(pathname);
  const projectOnlySlug = projectOnly?.project ?? null;
  const { flows: standaloneFlows } = useProjectFlows(projectOnlySlug);

  // External writes (CLI register / unregister) reach us via the global
  // registry SSE channel. Both flow and project lists refetch; node-level
  // state stays bound to the open demo and is untouched.
  useRegistryEvents({
    onRegistryReload: () => {
      refreshFlows();
      refreshProjects();
    },
  });

  const slug = match ? `${match.project}/${match.flow}` : null;
  const currentSummary = slug ? (demos ?? []).find((d) => d.slug === slug) : undefined;
  const flowId = currentSummary?.id ?? null;

  // US-031: when the URL points to a slug we don't yet have in the cached
  // demos list (e.g. the user just created a flow via the switcher popover
  // and the demos refresh hasn't echoed back yet), kick off a refresh so the
  // "Unknown demo" page resolves without the user having to reload the tab.
  // Demos is `null` while loading; only react once it's been resolved at
  // least once and is missing the slug.
  useEffect(() => {
    if (!slug) return;
    if (demos === null) return;
    if (currentSummary) return;
    refreshFlows();
  }, [slug, demos, currentSummary, refreshFlows]);

  const { detail, loading, refresh: refreshDetail, applyDetail } = useDemoData(project, flow);
  // Monotonic counter bumped ONLY when the watcher reports a real `flow:reload`
  // (a file-change signal — our own PATCH echo OR an external text-editor/git
  // edit). Threaded into DemoView so the undo-history stale-clear keys off
  // genuine reloads instead of every `detail` identity change. Reconnect
  // catch-ups (`onHello` → `refreshDetail`) deliberately do NOT bump it, so a
  // routine SSE reconnect can't wipe a populated undo stack.
  const [externalReloadSignal, setExternalReloadSignal] = useState(0);
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
      // Signal a genuine file-change reload to DemoView's undo-history
      // stale-clear. Fires for both our own PATCH echo (recent → kept) and a
      // true external edit (stale → cleared); the window math lives downstream.
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

  // US-006: `statusByNode` is exposed by the hook so US-007 can render the
  // per-node badge + sidebar status section. It threads through DemoView →
  // DemoCanvas / DetailPanel; the renderers in those files are wired in US-007.

  useStudioEvents(flowId, { onHello, onFlowReload, onEvent });

  const onProjectCreated = useCallback(
    (result: CreateProjectResult) => {
      writeLastProjectId(result.id);
      refreshFlows();
      refreshProjects();
    },
    [refreshFlows, refreshProjects],
  );

  // US-036: cascade-unregister every flow under a project. The hook handles
  // the per-flow DELETE loop + the projects refresh; here we refetch the
  // legacy demos list too and navigate away when the open flow lived under
  // the removed project.
  const onUnregisterProject = useCallback(
    async (projectSlug: string) => {
      await unregisterProject(projectSlug);
      await refreshFlows();
      if (project === projectSlug) navigate('/');
    },
    [unregisterProject, refreshFlows, project],
  );

  // On '/', skip the picker when there's nothing to pick: jump straight in if
  // only one demo is registered, or if the stored last-used demo still
  // resolves. Otherwise (2+ demos, no recall) StudioHome renders the picker.
  useEffect(() => {
    if (pathname !== '/') return;
    if (demos === null) return;
    const target = pickInitialDemo(demos, readLastProjectId());
    if (target) navigate(flowPathFromSlug(target.slug));
  }, [pathname, demos]);

  // US-001: persist whichever project is currently open so we can reopen it next visit.
  useEffect(() => {
    if (currentSummary) writeLastProjectId(currentSummary.id);
  }, [currentSummary]);

  // US-026: persist last-opened flow per project, keyed by project slug so
  // each project remembers its own last-visited flow independently.
  useEffect(() => {
    if (project && flow) writeLastFlow(project, flow);
  }, [project, flow]);

  // US-026: redirect `/projects/<project>` (no flow) to localStorage's
  // last-opened flow if it still resolves, else the project default, else the
  // first flow in the list. Fires once `standaloneFlows` is non-null (fetch
  // resolved). Empty list → no navigation (stays on StudioHome).
  useEffect(() => {
    if (!projectOnlySlug || !standaloneFlows) return;
    const picked = pickInitialFlow(standaloneFlows, readLastFlow(projectOnlySlug));
    if (picked) navigate(flowPath(projectOnlySlug, picked));
  }, [projectOnlySlug, standaloneFlows]);

  const onPlayNode = useCallback(
    (nodeId: string) => {
      if (!project || !flow) return;
      // Fire and forget — the SSE node:* events drive the UI; the synchronous
      // response is currently surfaced through the same SSE stream.
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

  // US-015: the canvas owns export — `canvasRef` populates once SeeflowCanvas
  // mounts inside DemoView. Lifted here (from DemoView) so the studio header
  // and the cloud-export dialog can both reach it without prop-drilling
  // through portals or context.
  const canvasRef = useRef<SeeflowCanvasHandle>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const share = useMemo<HeaderShareCallbacks | undefined>(() => {
    if (!flowId) return undefined;
    return {
      onDownloadPdf: () => canvasRef.current?.exportPdf(),
      onDownloadPng: () => canvasRef.current?.exportPng(),
      onExportToCloud: () => setExportDialogOpen(true),
    };
  }, [flowId]);

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
          projects={projects ?? []}
          currentProjectSlug={project ?? undefined}
          onProjectCreated={onProjectCreated}
          onUnregisterProject={onUnregisterProject}
          share={share}
        />
        <main className="min-h-0 flex-1">
          {project && flow && slug ? (
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
              canvasRef={canvasRef}
            />
          ) : (
            <StudioHome demos={demos} />
          )}
        </main>
        {flowId && project ? (
          <ExportDialog
            open={exportDialogOpen}
            onOpenChange={setExportDialogOpen}
            project={project}
            flowName={detail?.name ?? currentSummary?.name}
            onCapturePreview={() =>
              canvasRef.current?.capturePreview() ?? Promise.resolve(undefined)
            }
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}
