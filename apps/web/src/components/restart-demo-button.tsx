import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@seeflow/canvas';
import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';

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
          className="h-8 w-8"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Restart demo</TooltipContent>
    </Tooltip>
  );
}
