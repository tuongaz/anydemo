import { ProjectSwitcher } from '@/components/project-switcher';
import { reset as resetFlow } from '@/hooks/use-navigate-flow';
import { type Theme, useTheme } from '@/hooks/use-theme';
import type { CreateProjectResult, ProjectSummary } from '@/lib/api';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  ShareMenu,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@seeflow/canvas';
import { ArrowLeft, Settings, Workflow } from 'lucide-react';

export interface HeaderShareCallbacks {
  onDownloadPdf: () => Promise<unknown> | unknown;
  onDownloadPng: () => Promise<unknown> | unknown;
  onExportToCloud: () => void;
}

export interface HeaderProps {
  projects: ProjectSummary[];
  currentProjectSlug?: string;
  onProjectCreated?: (result: CreateProjectResult) => void;
  onUnregisterProject?: (projectSlug: string) => Promise<void>;
  /**
   * Renders the Share trigger between ProjectSwitcher and Settings. Pass
   * `undefined` (the default) when no flow is open — the trigger is hidden
   * entirely on StudioHome. Embed is intentionally left off here to mirror
   * the existing studio config.
   */
  share?: HeaderShareCallbacks;
  /**
   * US-007: when a previous flow is on the navigation stack (linkflow body
   * click pushed onto it), render a back arrow left of the SeeFlow logo.
   * `onBack` calls `popBack()` (== `history.back()`) so browser back + the
   * arrow share one reconciliation path. The button is suppressed when
   * `previousFlowName` is undefined — stack of length 1 or 0.
   */
  onBack?: () => void;
  previousFlowName?: string;
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function Header({
  projects,
  currentProjectSlug,
  onProjectCreated,
  onUnregisterProject,
  share,
  onBack,
  previousFlowName,
}: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const showBack = previousFlowName !== undefined;

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between bg-background/85 px-5 backdrop-blur-md shadow-[0_1px_3px_-1px_rgba(15,23,42,0.06),0_2px_8px_-4px_rgba(15,23,42,0.05)] dark:shadow-[0_4px_12px_-6px_rgba(0,0,0,0.6)]">
      <div className="flex items-center gap-2">
        {showBack ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onBack}
                aria-label="Back to previous flow"
                data-testid="flow-back-button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <ArrowLeft size={16} strokeWidth={2.25} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back to {previousFlowName}</TooltipContent>
          </Tooltip>
        ) : null}
        <button
          type="button"
          onClick={() => resetFlow(null)}
          className="-ml-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-base font-bold tracking-tight transition-colors hover:bg-muted/60"
        >
          <Workflow size={18} strokeWidth={2.25} className="text-emerald-400" />
          SeeFlow
          <span className="ml-1 text-[10px] font-normal tracking-normal text-muted-foreground/70">
            v{__APP_VERSION__}
          </span>
        </button>
      </div>
      <div className="flex items-center gap-3">
        <ProjectSwitcher
          projects={projects}
          currentProjectSlug={currentProjectSlug}
          onProjectCreated={onProjectCreated}
          onUnregisterProject={onUnregisterProject}
        />
        {share ? (
          <ShareMenu
            mode="edit"
            enableEmbed={false}
            onDownloadPdf={share.onDownloadPdf}
            onDownloadPng={share.onDownloadPng}
            onExportToCloud={share.onExportToCloud}
          />
        ) : null}
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
