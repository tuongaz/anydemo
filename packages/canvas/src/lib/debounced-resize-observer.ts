/**
 * Attach a ResizeObserver to `el` and call `onSettle` once size changes stop
 * arriving for `delayMs`. Coalesces bursts of reflows (e.g., Tailwind utility
 * hydration on mount, late-loading images) into a single settle. Each later
 * burst fires `onSettle` again.
 *
 * Used by `html-node.tsx` in auto-size mode: each settle calls
 * `useReactFlow().updateNodeInternals(nodeId)` so React Flow re-reads the
 * node's bounding rect from the DOM. The helper itself is React-free so it
 * can be unit-tested without the hook-shim infrastructure.
 *
 * Returns a cleanup function: disconnects the observer, clears any pending
 * timer. Safe to call multiple times.
 */
export function debouncedResizeObserver(
  el: Element,
  delayMs: number,
  onSettle: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cleaned = false;

  const observer = new ResizeObserver(() => {
    if (cleaned) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (cleaned) return;
      onSettle();
    }, delayMs);
  });
  observer.observe(el);

  return () => {
    if (cleaned) return;
    cleaned = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    observer.disconnect();
  };
}
