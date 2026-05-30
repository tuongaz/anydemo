import { CreateProjectDialog } from '@/components/create-project-dialog';
import { reset as resetFlow } from '@/hooks/use-navigate-flow';
import type { CreateProjectResult, ProjectSummary } from '@/lib/api';
import { readLastFlow } from '@/lib/last-flow';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@seeflow/canvas';
import { ChevronsUpDown, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface ProjectSwitcherProps {
  projects: ProjectSummary[];
  currentProjectSlug?: string;
  onProjectCreated?: (result: CreateProjectResult) => void;
  /**
   * US-036: cascade-delete every flow under the project. The switcher kicks
   * off the call; App.tsx is responsible for refreshing the demos cache and
   * navigating away if the open flow lived under the removed project.
   */
  onUnregisterProject?: (projectSlug: string) => Promise<void>;
}

export function ProjectSwitcher({
  projects,
  currentProjectSlug,
  onProjectCreated,
  onUnregisterProject,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [unregisterTarget, setUnregisterTarget] = useState<ProjectSummary | null>(null);
  const [unregistering, setUnregistering] = useState(false);
  const [unregisterError, setUnregisterError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const current = projects.find((p) => p.projectSlug === currentProjectSlug);

  const navigateToProject = (project: ProjectSummary): void => {
    // US-036: honor the per-project last-opened flow from US-026; fall back to
    // the manifest's defaultFlow when no preference has been recorded yet.
    const lastFlow = readLastFlow(project.projectSlug);
    const targetFlow = lastFlow ?? project.defaultFlow;
    resetFlow({ project: project.projectSlug, flow: targetFlow });
  };

  const handleCreated = (result: CreateProjectResult) => {
    onProjectCreated?.(result);
  };

  const openUnregisterDialog = (project: ProjectSummary) => {
    setUnregisterTarget(project);
    setUnregisterError(null);
  };

  const closeUnregisterDialog = () => {
    if (unregistering) return;
    setUnregisterTarget(null);
    setUnregisterError(null);
  };

  const handleUnregister = async () => {
    if (!unregisterTarget) return;
    setUnregistering(true);
    setUnregisterError(null);
    try {
      await onUnregisterProject?.(unregisterTarget.projectSlug);
      setUnregisterTarget(null);
    } catch (err) {
      setUnregisterError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnregistering(false);
    }
  };

  const flowCount = unregisterTarget?.flowCount ?? 0;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Switch project"
            aria-expanded={open}
            className="gap-2"
            data-testid="project-switcher-trigger"
          >
            <span className="max-w-[180px] truncate text-sm">
              {current?.name ?? 'Select project'}
            </span>
            <CommandShortcut>⌘K</CommandShortcut>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="relative w-[320px] p-0"
          data-testid="project-switcher-popover"
        >
          <Command>
            <CommandInput placeholder="Search projects..." />
            <CommandList className="pb-12">
              <CommandEmpty>No projects.</CommandEmpty>
              {projects.length > 0 ? (
                <CommandGroup heading="Projects">
                  {projects.map((project) => (
                    <CommandItem
                      key={project.projectSlug}
                      value={`${project.name} ${project.projectSlug}`}
                      onSelect={() => {
                        setOpen(false);
                        navigateToProject(project);
                      }}
                      data-testid={`project-switcher-row-${project.projectSlug}`}
                      className="group flex items-center justify-between gap-2"
                    >
                      <div className="flex min-w-0 flex-col items-start gap-0.5">
                        <span className="font-medium">{project.name}</span>
                        {project.repoPath ? (
                          <span className="w-full truncate text-xs text-muted-foreground">
                            {project.repoPath}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        aria-label={`Unregister ${project.name}`}
                        data-testid={`project-switcher-unregister-${project.projectSlug}`}
                        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(false);
                          openUnregisterDialog(project);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
          <button
            type="button"
            aria-label="Create new project"
            title="Create new project"
            data-testid="project-switcher-create"
            onClick={() => {
              setOpen(false);
              setCreateOpen(true);
            }}
            className="absolute right-2 bottom-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-colors hover:bg-emerald-400 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="h-4 w-4" />
          </button>
        </PopoverContent>
      </Popover>

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      <Dialog
        open={unregisterTarget !== null}
        onOpenChange={(o) => {
          if (!o) closeUnregisterDialog();
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="unregister-project-dialog">
          <DialogHeader>
            <DialogTitle>Unregister project?</DialogTitle>
            <DialogDescription>
              This removes <strong>{unregisterTarget?.name}</strong> from SeeFlow.{' '}
              <strong>
                All {flowCount} {flowCount === 1 ? 'flow' : 'flows'}
              </strong>{' '}
              under this project will be unregistered.
              {unregisterTarget?.repoPath ? (
                <>
                  {' '}
                  Your files at <code className="text-xs">{unregisterTarget.repoPath}</code> will
                  not be deleted.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {unregisterError ? (
            <div
              role="alert"
              data-testid="unregister-project-error"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {unregisterError}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={closeUnregisterDialog}
              disabled={unregistering}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleUnregister}
              disabled={unregistering}
              data-testid="unregister-project-confirm"
            >
              {unregistering ? 'Unregistering…' : 'Unregister'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
