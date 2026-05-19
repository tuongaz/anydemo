import { CreateProjectDialog } from '@/components/create-project-dialog';
import type { CreateProjectResult, FlowSummary } from '@/lib/api';
import { deleteFlow } from '@/lib/api';
import { navigate } from '@/lib/router';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
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
  demos: FlowSummary[];
  currentSlug?: string;
  onProjectCreated?: (result: CreateProjectResult) => void;
  onProjectUnregistered?: (id: string) => void;
}

export function ProjectSwitcher({
  demos,
  currentSlug,
  onProjectCreated,
  onProjectUnregistered,
}: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [unregisterTarget, setUnregisterTarget] = useState<FlowSummary | null>(null);
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

  const current = demos.find((d) => d.slug === currentSlug);

  const handleCreated = (result: CreateProjectResult) => {
    onProjectCreated?.(result);
    navigate(`/d/${result.slug}`);
  };

  const openUnregisterDialog = (demo: FlowSummary) => {
    setUnregisterTarget(demo);
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
      await deleteFlow(unregisterTarget.id);
      const id = unregisterTarget.id;
      setUnregisterTarget(null);
      onProjectUnregistered?.(id);
    } catch (err) {
      setUnregisterError(err instanceof Error ? err.message : String(err));
    } finally {
      setUnregistering(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Switch demo"
            aria-expanded={open}
            className="gap-2"
            data-testid="project-switcher-trigger"
          >
            <span className="max-w-[180px] truncate text-sm">{current?.name ?? 'Select demo'}</span>
            <CommandShortcut>⌘K</CommandShortcut>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-[320px] p-0"
          data-testid="project-switcher-popover"
        >
          <Command>
            <CommandInput placeholder="Search demos..." />
            <CommandList>
              <CommandEmpty>No demos.</CommandEmpty>
              {demos.length > 0 ? (
                <CommandGroup heading="Demos">
                  {demos.map((demo) => (
                    <CommandItem
                      key={demo.id}
                      value={`${demo.name} ${demo.slug}`}
                      onSelect={() => {
                        setOpen(false);
                        navigate(`/d/${demo.slug}`);
                      }}
                      className="group flex items-center justify-between gap-2"
                    >
                      <div className="flex min-w-0 flex-col items-start gap-0.5">
                        <span className="font-medium">{demo.name}</span>
                        <span className="w-full truncate text-xs text-muted-foreground">
                          {demo.repoPath}
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Unregister ${demo.name}`}
                        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(false);
                          openUnregisterDialog(demo);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {demos.length > 0 ? <CommandSeparator /> : null}
              <CommandGroup>
                <CommandItem
                  value="+ create new project"
                  onSelect={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                  data-testid="project-switcher-create"
                  className="flex items-center gap-2 text-sm"
                >
                  <Plus className="h-4 w-4 opacity-70" />
                  <span className="font-medium">Create new project</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
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
              This removes <strong>{unregisterTarget?.name}</strong> from SeeFlow. Your files at{' '}
              <code className="text-xs">{unregisterTarget?.repoPath}</code> will not be deleted.
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
