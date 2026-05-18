import { cn } from '@seeflow/canvas';

/**
 * US-014: shared inline placeholder for file-backed renderers when the
 * underlying file is missing, loading, or failed to load. Used by the
 * htmlNode renderer for the missing-file state; future renderers (image-node
 * upload placeholder, etc.) can adopt the same component when their inlined
 * placeholders are extracted.
 */
export function PlaceholderCard({
  message,
  variant = 'muted',
  className,
}: {
  message: string;
  variant?: 'muted' | 'destructive';
  className?: string;
}) {
  return (
    <div
      data-testid="placeholder-card"
      data-placeholder-variant={variant}
      className={cn(
        'pointer-events-none flex h-full w-full select-none items-center justify-center px-2 text-center text-xs',
        variant === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {message}
    </div>
  );
}
