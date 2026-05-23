import { ProjectSwitcher } from '@/components/project-switcher';
import { type Theme, useTheme } from '@/hooks/use-theme';
import type { CreateProjectResult, FlowSummary } from '@/lib/api';
import { navigate } from '@/lib/router';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@seeflow/canvas';
import { Settings, Workflow } from 'lucide-react';

export interface HeaderProps {
  demos: FlowSummary[];
  currentSlug?: string;
  onProjectCreated?: (result: CreateProjectResult) => void;
  onProjectUnregistered?: (id: string) => void;
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function Header({
  demos,
  currentSlug,
  onProjectCreated,
  onProjectUnregistered,
}: HeaderProps) {
  const { theme, setTheme } = useTheme();

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Settings"
              data-testid="settings-trigger"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="w-44"
            data-testid="settings-menu"
          >
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value as Theme)}
            >
              {THEME_OPTIONS.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  data-testid={`theme-${option.value}`}
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
