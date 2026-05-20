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
    <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/85 px-5 backdrop-blur-md shadow-[0_4px_12px_-6px_rgba(0,0,0,0.6)]">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="-ml-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-base font-bold tracking-tight transition-colors hover:bg-muted/60"
      >
        <Workflow size={18} strokeWidth={2.25} className="text-emerald-400" />
        SeeFlow
        <span className="ml-1 text-[10px] font-normal tracking-normal text-muted-foreground/70">
          v{__APP_VERSION__}
        </span>
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
