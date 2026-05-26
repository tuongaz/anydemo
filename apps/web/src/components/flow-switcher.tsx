import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@seeflow/canvas';
import { ChevronsUpDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

export interface FlowSwitcherEntry {
  flowSlug: string;
  name: string;
  icon?: string;
  isDefault: boolean;
}

export interface FlowSwitcherProps {
  project: string;
  activeFlow: string;
  flows: readonly FlowSwitcherEntry[];
  onSelect?: (flowSlug: string) => void;
  onCreate?: () => void;
  onRename?: (flowSlug: string) => void;
  onDelete?: (flowSlug: string) => void;
}

export function FlowSwitcher({
  project,
  activeFlow,
  flows,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: FlowSwitcherProps) {
  const [open, setOpen] = useState(false);

  const current = flows.find((f) => f.flowSlug === activeFlow);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Switch flow for ${project}`}
          aria-expanded={open}
          className="gap-2"
          data-testid="flow-switcher-trigger"
        >
          <span className="max-w-[180px] truncate text-sm">{current?.name ?? activeFlow}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[260px] p-0"
        data-testid="flow-switcher-popover"
      >
        <Command>
          <CommandList>
            <CommandEmpty>No flows.</CommandEmpty>
            {flows.length > 0 ? (
              <CommandGroup heading="Flows">
                {flows.map((flow) => {
                  const isActive = flow.flowSlug === activeFlow;
                  return (
                    <CommandItem
                      key={flow.flowSlug}
                      value={`${flow.name} ${flow.flowSlug}`}
                      aria-current={isActive ? 'true' : undefined}
                      data-testid={`flow-switcher-row-${flow.flowSlug}`}
                      data-active={isActive ? 'true' : undefined}
                      onSelect={() => {
                        setOpen(false);
                        onSelect?.(flow.flowSlug);
                      }}
                      className={cn(
                        'group flex items-center justify-between gap-2',
                        isActive && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {flow.icon ? (
                          <span aria-hidden="true" className="text-xs opacity-70">
                            {flow.icon}
                          </span>
                        ) : null}
                        <span className="truncate font-medium">{flow.name}</span>
                        {flow.isDefault ? (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            default
                          </span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          aria-label={`Rename ${flow.name}`}
                          data-testid={`flow-switcher-rename-${flow.flowSlug}`}
                          className="rounded p-0.5 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                            onRename?.(flow.flowSlug);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${flow.name}`}
                          data-testid={`flow-switcher-delete-${flow.flowSlug}`}
                          className="rounded p-0.5 hover:text-destructive focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                            onDelete?.(flow.flowSlug);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {flows.length > 0 ? <CommandSeparator /> : null}
            <CommandGroup>
              <CommandItem
                value="+ new flow"
                data-testid="flow-switcher-create"
                onSelect={() => {
                  setOpen(false);
                  onCreate?.();
                }}
                className="flex items-center gap-2 text-sm"
              >
                <Plus className="h-4 w-4 opacity-70" />
                <span className="font-medium">New flow</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
