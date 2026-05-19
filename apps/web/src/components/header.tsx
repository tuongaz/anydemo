import { ProjectSwitcher } from '@/components/project-switcher';
import type { CreateProjectResult, FlowSummary } from '@/lib/api';
import { navigate } from '@/lib/router';
import { Workflow } from 'lucide-react';

export interface HeaderProps {
  demos: FlowSummary[];
  currentSlug?: string;
  onProjectCreated?: (result: CreateProjectResult) => void;
  onProjectUnregistered?: (id: string) => void;
}

export function Header({
  demos,
  currentSlug,
  onProjectCreated,
  onProjectUnregistered,
}: HeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
      <button
        type="button"
        onClick={() => navigate('/')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontWeight: 700,
          fontSize: 16,
          letterSpacing: '-0.02em',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <Workflow size={20} strokeWidth={2} className="text-emerald-400" />
        SeeFlow
      </button>
      <div className="flex items-center gap-3">
        <ProjectSwitcher
          demos={demos}
          currentSlug={currentSlug}
          onProjectCreated={onProjectCreated}
          onProjectUnregistered={onProjectUnregistered}
        />
      </div>
    </header>
  );
}
