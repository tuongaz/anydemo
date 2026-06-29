import { ExportDialog } from '@/components/export-dialog';
import { Header, type HeaderShareCallbacks } from '@/components/header';
import { MembersShareDialog } from '@/components/members-share-dialog';
import { useDemos } from '@/hooks/use-demos';
import {
  ensureFlowNavigation,
  navigateToFlow,
  popBack,
  reset as resetFlow,
  useFlowStack,
} from '@/hooks/use-navigate-flow';
import { useProjectFlows } from '@/hooks/use-project-flows';
import { useProjects } from '@/hooks/use-projects';
import { useRegistryEvents } from '@/hooks/use-registry-events';
import type { CreateProjectResult } from '@/lib/api';
import { useAppConfig } from '@/lib/auth/app-config';
import { readBootConfig } from '@/lib/boot-config';
import { fetchAccessibleProjects } from '@/lib/cloud-members-api';
import { pickInitialFlow, readLastFlow, writeLastFlow } from '@/lib/last-flow';
import { pickInitialDemo, readLastProjectId, writeLastProjectId } from '@/lib/last-project';
import { matchProjectAlone, splitFlowSlug, usePathname } from '@/lib/router';
import { FlowStackPane } from '@/pages/flow-stack-pane';
import { StudioHome } from '@/pages/studio-home';
import { type SeeflowCanvasHandle, TooltipProvider } from '@seeflow/canvas';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// US-005: seed the flow navigation stack from the initial URL + stamp
// history.state.stackDepth so the popstate handler has a reliable signal.
// Idempotent — safe to call from App's module load (App is mounted once).
if (typeof window !== 'undefined') ensureFlowNavigation();

export function App() {
  const pathname = usePathname();
  const { demos, refresh: refreshFlows } = useDemos();
  // US-036: the top-right ProjectSwitcher is sourced from `GET /api/projects`
  // so a multi-flow project surfaces once, not once per flow. The legacy
  // `demos` list (FlowSummary[]) still backs the canvas page resolution, the
  // `/` landing picker, and SSE-driven detail caches.
  const { projects, refresh: refreshProjects, unregisterProject } = useProjects();
  // US-006: one entry per mounted flow. The renderer (FlowStackPane) owns
  // the per-entry data + SSE wiring so a hidden DemoView keeps its state +
  // viewport + connection alive. App reads only the top entry for
  // header/last-flow plumbing.
  const stack = useFlowStack();
  const topEntry = stack.at(-1) ?? null;
  const topProject = topEntry?.project ?? null;
  const topSlug = topEntry?.slug ?? null;
  // US-007: header back-arrow surfaces iff a previous flow is on the stack
  // (linkflow body click pushed the current entry on top). We resolve the
  // previous entry's human-readable name via the demos cache when possible,
  // falling back to the flow slug so the tooltip never reads "Back to undefined".
  const prevEntry = stack.length > 1 ? (stack.at(-2) ?? null) : null;

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

  const currentSummary = topSlug ? (demos ?? []).find((d) => d.slug === topSlug) : undefined;

  // US-031: when the URL points to a slug we don't yet have in the cached
  // demos list (e.g. the user just created a flow via the switcher popover
  // and the demos refresh hasn't echoed back yet), kick off a refresh so the
  // "Unknown demo" page resolves without the user having to reload the tab.
  // Demos is `null` while loading; only react once it's been resolved at
  // least once and is missing the slug.
  //
  // HARD CAP: refetch AT MOST ONCE per missing slug. The original effect
  // refetched on every `demos` change while `currentSummary` was undefined — so
  // a slug the registry can NEVER return (a stale/unreachable URL, or a host
  // shell that can't address it) spun `GET /api/flows` forever (the "infinite
  // /api/flows" report). One refetch still catches the just-created-not-yet-
  // echoed race; if the slug still isn't there, fall through to the Unknown-demo
  // page instead of hammering the server. (Registry SSE reloads refresh
  // separately, so an externally-registered slug still resolves live.)
  const healAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!topSlug) return;
    if (demos === null) return;
    if (currentSummary) return;
    if (healAttemptedRef.current.has(topSlug)) return;
    healAttemptedRef.current.add(topSlug);
    refreshFlows();
  }, [topSlug, demos, currentSummary, refreshFlows]);

  const onProjectCreated = useCallback(
    (result: CreateProjectResult) => {
      writeLastProjectId(result.id);
      refreshFlows();
      refreshProjects();
      // createProjectImpl always scaffolds a default flow, so the fresh project
      // is immediately navigable. Navigate with the BARE projectSlug + its
      // defaultFlow — `result.slug` is flow-qualified (`<proj>/<flow>`), so
      // passing it as `project` produced a malformed
      // `/projects/<proj>%2F<flow>/flows/main` URL and the "Unknown demo" page.
      // `navigateToFlow` (not `resetFlow`) so that under a single-project boot
      // shell (cloud `/p/<id>`) the brand-new project — which is NOT the booted
      // one — full-loads into the multi-project studio instead of silently
      // staying on the booted project (the "create does nothing + /api/flows
      // refetch storm" bug).
      navigateToFlow({ project: result.projectSlug, flow: result.defaultFlow });
    },
    [refreshFlows, refreshProjects],
  );

  // Unregister a project (and optionally rm-rf its repoPath). The hook calls
  // the atomic project-level DELETE endpoint and refreshes the projects list;
  // here we refetch the legacy demos list too and navigate away when the open
  // flow lived under the removed project.
  const onUnregisterProject = useCallback(
    async (projectSlug: string, opts?: { deleteSource?: boolean }) => {
      await unregisterProject(projectSlug, opts);
      await refreshFlows();
      if (topProject === projectSlug) resetFlow(null);
    },
    [unregisterProject, refreshFlows, topProject],
  );

  // On the FIRST load only, skip the picker when there's nothing to pick: jump
  // straight in if only one demo is registered, or if the stored last-used demo
  // still resolves. Otherwise (2+ demos, no recall) StudioHome renders the picker.
  //
  // This runs once per app mount — gated on `autoResumedRef`. Re-running it on
  // every navigation to '/' would make "home" unreachable: an explicit go-home
  // (the SeeFlow logo, or the cloud avatar menu's "My projects") lands on '/',
  // and the effect would immediately bounce back to the last-opened flow.
  // config.mode === 'cloud'. Gates cloud-only behaviour below (last-project
  // recall is disabled in cloud; the share affordance is resolved differently).
  const { isCloud } = useAppConfig();

  const autoResumedRef = useRef(false);
  useEffect(() => {
    if (demos === null) return;
    if (autoResumedRef.current) return;
    autoResumedRef.current = true;
    // Cloud is multi-account on a single origin: `seeflow:last-project` is shared
    // localStorage, so a value left by a previous session/account must NOT
    // auto-load — after logging into a different account you may have no access
    // to it. Local studio (single user, no auth) keeps the recall.
    if (isCloud) return;
    if (pathname !== '/') return;
    const target = pickInitialDemo(demos, readLastProjectId());
    if (target) {
      const split = splitFlowSlug(target.slug);
      if (split) resetFlow(split);
    }
  }, [pathname, demos, isCloud]);

  // US-001: persist whichever project is currently open so we can reopen it next
  // visit — local studio only (see above: in cloud the key would bleed across
  // accounts on a shared origin, so we neither store nor recall it).
  useEffect(() => {
    if (isCloud) return;
    if (currentSummary) writeLastProjectId(currentSummary.id);
  }, [currentSummary, isCloud]);

  // US-026: persist last-opened flow per project, keyed by project slug so
  // each project remembers its own last-visited flow independently.
  useEffect(() => {
    if (topEntry) writeLastFlow(topEntry.project, topEntry.flow);
  }, [topEntry]);

  // US-026: redirect `/projects/<project>` (no flow) to localStorage's
  // last-opened flow if it still resolves, else the project default, else the
  // first flow in the list. Fires once `standaloneFlows` is non-null (fetch
  // resolved). Empty list → no navigation (stays on StudioHome).
  useEffect(() => {
    if (!projectOnlySlug || !standaloneFlows) return;
    const picked = pickInitialFlow(standaloneFlows, readLastFlow(projectOnlySlug));
    if (picked) resetFlow({ project: projectOnlySlug, flow: picked });
  }, [projectOnlySlug, standaloneFlows]);

  // US-015 + linkflow merge: canvasRef lives at App so the studio header
  // (ShareMenu) and the cloud-export dialog can both reach the canvas
  // imperative handle. FlowStackPane plumbs the ref onto the TOP stack
  // entry's SeeflowCanvas only — non-top mounts use a throwaway local ref so
  // a hidden flow can't silently overwrite the visible flow's handle.
  const canvasRef = useRef<SeeflowCanvasHandle>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const flowId = currentSummary?.id ?? null;

  // "Share with people" is a host (cloud) feature: it needs the open project's
  // internal cloud project id + an OWNER flag (only the owner may (re)share; the
  // cloud grants API enforces this server-side too — defense in depth). There are
  // two ways the studio learns them:
  //   1. Boot config (the single-project /p/<id> shell) injects projectId +
  //      canShare directly — the fast path. A shared `editor` gets the full editor
  //      but canShare:false, so no Share button.
  //   2. The multi-project /app studio has NO boot config (e.g. right after
  //      creating a project). There we resolve the OPEN project (by slug) against
  //      the cloud DB's accessible-projects list — owner ⇒ canShare. This is why a
  //      freshly-created project is now shareable. Local studio: isCloud is false,
  //      the fetch never runs, and the item stays hidden.
  const boot = useMemo(() => readBootConfig(), []);
  const [dbShare, setDbShare] = useState<{ projectId: string; canShare: boolean } | null>(null);
  useEffect(() => {
    if (!isCloud || boot || !topProject) {
      setDbShare(null);
      return;
    }
    let cancelled = false;
    fetchAccessibleProjects()
      .then((projects) => {
        if (cancelled) return;
        const row = projects.find((p) => p.slug === topProject);
        setDbShare(row ? { projectId: row.projectId, canShare: row.access === 'owner' } : null);
      })
      .catch(() => {
        // Best-effort: a failed lookup just hides Share (never crashes the editor).
        if (!cancelled) setDbShare(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isCloud, boot, topProject]);

  const cloudProjectId = boot?.projectId ?? dbShare?.projectId ?? null;
  const canShare = boot ? boot.canShare === true : dbShare?.canShare === true;
  const canShareMembers = isCloud && cloudProjectId !== null && canShare;

  const share = useMemo<HeaderShareCallbacks | undefined>(() => {
    if (!flowId) return undefined;
    return {
      onDownloadPdf: () => canvasRef.current?.exportPdf(),
      onDownloadPng: () => canvasRef.current?.exportPng(),
      onExportToCloud: () => setExportDialogOpen(true),
      onShareWithMembers: canShareMembers ? () => setMembersDialogOpen(true) : undefined,
    };
  }, [flowId, canShareMembers]);

  if (demos === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const previousFlowName = prevEntry
    ? (demos.find((d) => d.slug === prevEntry.slug)?.name ?? prevEntry.flow)
    : undefined;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full w-full flex-col bg-background text-foreground">
        <Header
          projects={projects ?? []}
          currentProjectSlug={topProject ?? undefined}
          onProjectCreated={onProjectCreated}
          onUnregisterProject={onUnregisterProject}
          share={share}
          onBack={previousFlowName ? popBack : undefined}
          previousFlowName={previousFlowName}
        />
        <main className="min-h-0 flex-1">
          {stack.length > 0 ? (
            <FlowStackPane demos={demos} refreshFlows={refreshFlows} canvasRef={canvasRef} />
          ) : (
            <StudioHome demos={demos} onProjectCreated={onProjectCreated} />
          )}
        </main>
        {flowId && topProject ? (
          <ExportDialog
            open={exportDialogOpen}
            onOpenChange={setExportDialogOpen}
            project={topProject}
            flowName={currentSummary?.name}
            onCapturePreview={() =>
              canvasRef.current?.capturePreview() ?? Promise.resolve(undefined)
            }
          />
        ) : null}
        {canShareMembers && cloudProjectId ? (
          <MembersShareDialog
            open={membersDialogOpen}
            onOpenChange={setMembersDialogOpen}
            projectId={cloudProjectId}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}
