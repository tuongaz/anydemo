import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.ts';

// Mermaid ships as an optional peer dep — we never import it at module scope.
// The dynamic import keeps it out of @seeflow/canvas's dist bundle (it's also
// listed in tsup `external`), and when the consumer hasn't installed it the
// import rejects and MermaidBlock falls back to a plain <pre><code>.
//
// `MermaidModule` mirrors the shape we use (initialize + render). Typed as a
// local interface so the canvas builds cleanly without a hard `mermaid`
// devDep in this file.
interface MermaidModule {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
}

let mermaidPromise: Promise<MermaidModule> | null = null;
let mermaidIdCounter = 0;

function loadMermaid(): Promise<MermaidModule> {
  if (mermaidPromise) return mermaidPromise;
  // Plain `import('mermaid')` so bundlers see the spec — tsup keeps it as a
  // bare-import dynamic chunk because 'mermaid' is in `external`.
  mermaidPromise = import('mermaid').then((mod: unknown) => {
    const raw = mod as { default?: MermaidModule } & MermaidModule;
    return (raw.default ?? raw) as MermaidModule;
  });
  return mermaidPromise;
}

/**
 * Read the dark/light theme from the DOM the same way the rest of the canvas
 * does — any `.dark` ancestor flips the palette (matches the
 * `&:is(.dark *)` custom-variant in `styles/index.css`). Mermaid runs outside
 * Tailwind so we feed it the resolved value at render time.
 */
function detectDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.classList.contains('dark')) return true;
  if (document.body?.classList.contains('dark')) return true;
  return !!document.querySelector('.dark');
}

export interface MermaidBlockProps {
  code: string;
  className?: string;
}

/**
 * Renders a Mermaid diagram from its source. Used by the DetailPanel's
 * markdown renderer to upgrade ```mermaid fenced code blocks into SVG.
 *
 * SVG injection: Mermaid produces the SVG itself. We pass `securityLevel:
 * 'strict'` so the library sanitizes its inputs before emitting markup, and
 * the source code itself comes from the user's own flow.json (a trust
 * boundary the canvas already crosses for every other rendered field). The
 * SVG is written into the container via `ref.innerHTML` in a useEffect, not
 * through `dangerouslySetInnerHTML`, so React never re-runs the assignment
 * unless `code` or `isDark` actually changes.
 *
 * Theme tracking: a MutationObserver on <html> / <body> classList re-renders
 * the diagram when the consumer flips between light + dark so the palette
 * stays in sync with the rest of the canvas.
 */
export function MermaidBlock({ code, className }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Stable per-instance id for mermaid's internal SVG id namespace. Bumped
  // module-counter avoids collisions when multiple diagrams render in one
  // panel.
  const idRef = useRef<string>(`seeflow-mermaid-${++mermaidIdCounter}`);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDark, setIsDark] = useState<boolean>(() => detectDarkTheme());

  // Watch the document for theme flips. Cheap MutationObserver scoped to the
  // `class` attribute on <html> + <body> — every consumer's dark toggle
  // touches one of those nodes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () => setIsDark(detectDarkTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setErrorMessage(null);
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'strict',
          fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
        });
        // Suffix the id with the theme so mermaid doesn't reuse a stale
        // cached node across re-renders.
        const renderId = `${idRef.current}-${isDark ? 'd' : 'l'}`;
        const result = await mermaid.render(renderId, code);
        if (cancelled) return;
        const el = containerRef.current;
        if (el) el.innerHTML = result.svg;
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, isDark]);

  if (errorMessage) {
    return (
      <pre
        data-testid="detail-panel-mermaid-fallback"
        data-mermaid-error="true"
        title={errorMessage}
        className={cn(
          'sf:mb-2 sf:overflow-x-auto sf:rounded sf:bg-muted/60 sf:px-2 sf:py-1 sf:font-mono sf:text-xs sf:text-foreground sf:last:mb-0',
          className,
        )}
      >
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="detail-panel-mermaid"
      data-mermaid-theme={isDark ? 'dark' : 'light'}
      role="img"
      aria-label="Mermaid diagram"
      className={cn(
        'sf:mb-2 sf:overflow-x-auto sf:rounded sf:bg-muted/30 sf:px-3 sf:py-2 sf:text-foreground sf:last:mb-0',
        className,
      )}
    />
  );
}
