import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '../ui/button.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

export interface RestartDemoButtonProps {
  onRestartDemo: () => Promise<unknown>;
}

export function RestartDemoButton({ onRestartDemo }: RestartDemoButtonProps) {
  const [pending, setPending] = useState(false);

  const handleClick = useCallback(() => {
    if (pending) return;
    setPending(true);
    Promise.resolve(onRestartDemo()).finally(() => {
      setPending(false);
    });
  }, [onRestartDemo, pending]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-testid="header-restart-demo"
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Restart demo"
          title="Restart demo"
          disabled={pending}
          onClick={handleClick}
          className="sf:h-8 sf:w-8"
        >
          {pending ? (
            <Loader2 className="sf:h-4 sf:w-4 sf:animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="sf:h-4 sf:w-4" aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Restart demo</TooltipContent>
    </Tooltip>
  );
}
