import { EmptyState } from '@/components/empty-state';
import { reset as resetFlow } from '@/hooks/use-navigate-flow';
import type { CreateProjectResult, FlowSummary } from '@/lib/api';
import { splitFlowSlug } from '@/lib/router';

export interface StudioHomeProps {
  flows: FlowSummary[];
  /** Forwarded to the empty-state "Create a project" CTA. */
  onProjectCreated?: (result: CreateProjectResult) => void;
}

export function StudioHome({ flows, onProjectCreated }: StudioHomeProps) {
  if (flows.length === 0) return <EmptyState onProjectCreated={onProjectCreated} />;
  return (
    <div className="flex h-full w-full items-start justify-center overflow-y-auto bg-background p-8">
      <div data-testid="studio-home-picker" className="flex w-full max-w-2xl flex-col gap-6 pt-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Open a flow</h1>
          <p className="text-sm text-muted-foreground">
            {flows.length} flows across your registered projects — pick one to load its canvas.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {flows.map((flow) => (
            <li key={flow.id}>
              <button
                type="button"
                onClick={() => {
                  const target = splitFlowSlug(flow.slug);
                  if (target) resetFlow(target);
                }}
                data-testid={`studio-home-flow-${flow.slug}`}
                className="flex w-full flex-col items-start gap-0.5 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-input"
                style={{ boxShadow: 'var(--shadow-card)' }}
              >
                <span className="text-sm font-medium">{flow.name}</span>
                <span className="truncate text-xs text-muted-foreground">{flow.repoPath}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
