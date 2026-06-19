import { CreateProjectDialog } from '@/components/create-project-dialog';
import type { CreateProjectResult } from '@/lib/api';
import { useAppConfig } from '@/lib/auth/app-config';
import { Button } from '@seeflow/canvas';
import { Check, Copy, FolderPlus, Terminal } from 'lucide-react';
import { useState } from 'react';

const REGISTER_COMMAND = 'npx seeflow register --path .';

export interface EmptyStateProps {
  /** Cloud only: invoked after the inline "Create your first project" succeeds. */
  onProjectCreated?: (result: CreateProjectResult) => void;
}

export function EmptyState({ onProjectCreated }: EmptyStateProps) {
  const { isCloud } = useAppConfig();
  const [copied, setCopied] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(REGISTER_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error('[empty-state] copy failed', err);
    }
  };

  return (
    <div
      data-testid="seeflow-empty-state"
      className="flex h-full w-full items-center justify-center bg-background p-6"
    >
      <div className="flex max-w-lg flex-col items-center gap-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          {isCloud ? (
            <FolderPlus className="h-6 w-6 text-muted-foreground" />
          ) : (
            <Terminal className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        {isCloud ? (
          <>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                No projects yet
              </h1>
              <p className="text-sm text-muted-foreground">
                Create your first project to start building a flow.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              data-testid="empty-state-create-project"
            >
              <FolderPlus className="mr-2 h-4 w-4" />
              Create your first project
            </Button>
            <CreateProjectDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              onCreated={(result) => onProjectCreated?.(result)}
            />
          </>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                No demos registered yet
              </h1>
              <p className="text-sm text-muted-foreground">
                Point SeeFlow at any folder containing a{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">flow.json</code> file and
                it'll appear here.
              </p>
            </div>
            <div className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2 font-mono text-sm">
              <span className="text-muted-foreground select-none">$</span>
              <code className="flex-1 truncate text-left">{REGISTER_COMMAND}</code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCopy}
                aria-label="Copy register command"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
