/**
 * Host-owned first-open auto-fit decision.
 *
 * The studio runs `<SeeflowCanvas autoFitView={false}>` and owns framing here,
 * because only the host can tell "empty because the flow is still loading"
 * from "empty because the user is about to create the first node." We frame a
 * flow EXACTLY ONCE — when its initial load settles and it has content — and
 * never again, so node-create and SSE reload leave the viewport where the user
 * left it.
 *
 * Outcomes:
 *  - `'skip'`      → do nothing, do NOT mark the flow framed (already framed,
 *                    or the initial load hasn't settled yet).
 *  - `'mark-only'` → mark framed but don't fit (flow settled empty; the first
 *                    node the user creates must not trigger a zoom).
 *  - `'fit-now'`   → mark framed and fit immediately (rf instance is ready).
 *  - `'defer'`     → mark framed; the rf instance isn't ready, so the fit is
 *                    deferred until the canvas's onRfInit fires.
 */
export type FirstOpenFitDecision = 'skip' | 'mark-only' | 'fit-now' | 'defer';

export function decideFirstOpenFit(args: {
  alreadyFitted: boolean;
  loading: boolean;
  hasDetail: boolean;
  nodeCount: number;
  rfReady: boolean;
}): FirstOpenFitDecision {
  if (args.alreadyFitted) return 'skip';
  // Wait for the initial load to settle so an async-loading non-empty flow
  // isn't mistaken for an empty one.
  if (args.loading || !args.hasDetail) return 'skip';
  if (args.nodeCount === 0) return 'mark-only';
  return args.rfReady ? 'fit-now' : 'defer';
}
