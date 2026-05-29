import { PanelRightClose, PanelRightOpen } from 'lucide-react';

import { Button } from '../ui/button.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip.tsx';

export interface InspectorToggleProps {
  open: boolean;
  onToggle: () => void;
}

const TOOLTIP_OPEN = 'Hide inspector';
const TOOLTIP_CLOSED = 'Open inspector';

/**
 * Top-right chrome affordance that opens / closes the canvas inspector
 * (right-hand DetailPanel). Stateless — the parent owns `open`. Renders the
 * existing ghost-variant Button at 32x32 so it visually pairs with the
 * sibling ShareMenu trigger.
 */
export function InspectorToggle({ open, onToggle }: InspectorToggleProps) {
  const Icon = open ? PanelRightClose : PanelRightOpen;
  const label = open ? TOOLTIP_OPEN : TOOLTIP_CLOSED;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="inspector-toggle"
            aria-pressed={open}
            aria-label={label}
            onClick={onToggle}
            className="sf:h-8 sf:w-8"
          >
            <Icon className="sf:h-4 sf:w-4" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
