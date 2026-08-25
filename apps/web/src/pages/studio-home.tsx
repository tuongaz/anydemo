import { EmptyState } from '@/components/empty-state';
import { reset as resetFlow } from '@/hooks/use-navigate-flow';
import type { CreateProjectResult, FlowSummary } from '@/lib/api';
import { splitFlowSlug } from '@/lib/router';

export interface StudioHomeProps {
  demos: FlowSummary[];
  /** Forwarded to the empty-state "Create a project" CTA. */
  onProjectCreated?: (result: CreateProjectResult) => void;
}

export function StudioHome({ demos, onProjectCreated }: StudioHomeProps) {
  if (demos.length === 0) return <EmptyState onProjectCreated={onProjectCreated} />;
  return (
    <div className="flex h-full w-full items-start justify-center overflow-y-auto bg-background p-8">
      <div data-testid="studio-home-picker" className="flex w-full max-w-2xl flex-col gap-6 pt-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Open a demo</h1>
          <p className="text-sm text-muted-foreground">
            {demos.length} demos registered — pick one to load its canvas.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {demos.map((demo) => (
            <li key={demo.id}>
              <button
                type="button"
                onClick={() => {
                  const target = splitFlowSlug(demo.slug);
                  if (target) resetFlow(target);
                }}
                data-testid={`studio-home-demo-${demo.slug}`}
                className="flex w-full flex-col items-start gap-0.5 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-input"
                style={{ boxShadow: 'var(--shadow-card)' }}
              >
                <span className="text-sm font-medium">{demo.name}</span>
                <span className="truncate text-xs text-muted-foreground">{demo.repoPath}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
