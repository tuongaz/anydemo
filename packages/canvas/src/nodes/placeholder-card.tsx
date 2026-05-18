import { cn } from '../lib/cn.ts';

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
        'sf-pointer-events-none sf-flex sf-h-full sf-w-full sf-select-none sf-items-center sf-justify-center sf-px-2 sf-text-center sf-text-xs',
        variant === 'destructive' ? 'sf-text-destructive' : 'sf-text-muted-foreground',
        className,
      )}
    >
      {message}
    </div>
  );
}
