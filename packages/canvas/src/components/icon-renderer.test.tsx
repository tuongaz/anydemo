import { describe, expect, it } from 'bun:test';
import { HelpCircle } from 'lucide-react';
import { ICON_REGISTRY } from '../lib/icon-registry.ts';
import { IconRenderer, type IconRendererProps } from './icon-renderer.tsx';

// IconRenderer's main body has no hooks — it dispatches via resolveIcon and
// returns either a HelpCircle, a Lucide component, an <img>, or the
// (hooked) IconifyOrPlaceholder element. Calling it as a function gives us
// the first-render element directly so we can assert on `type` + `props`
// without a DOM.
type ReactElementLike = { type: unknown; props: Record<string, unknown> };

function callIconRenderer(props: IconRendererProps): ReactElementLike {
  return IconRenderer(props) as unknown as ReactElementLike;
}

describe('IconRenderer', () => {
  it('renders the Lucide component for a bundled icon name', () => {
    const el = callIconRenderer({ iconId: 'database', studioBaseUrl: '' });
    expect(el.type).toBe(ICON_REGISTRY.database);
    expect(el.props.className).toBeUndefined();
  });

  it('plumbs color / strokeWidth / className to the Lucide component', () => {
    const el = callIconRenderer({
      iconId: 'shopping-cart',
      studioBaseUrl: '',
      color: 'red',
      strokeWidth: 3,
      absoluteStrokeWidth: true,
      className: 'sf:h-6 sf:w-6',
      ariaLabel: 'Cart',
    });
    expect(el.type).toBe(ICON_REGISTRY['shopping-cart']);
    expect(el.props.color).toBe('red');
    expect(el.props.strokeWidth).toBe(3);
    expect(el.props.absoluteStrokeWidth).toBe(true);
    expect(el.props.className).toBe('sf:h-6 sf:w-6');
    expect(el.props['aria-label']).toBe('Cart');
    // ariaLabel provided ⇒ NOT aria-hidden.
    expect(el.props['aria-hidden']).toBeUndefined();
  });

  it('renders an <img> with the studio /api/icons URL for a vendor icon', () => {
    const el = callIconRenderer({
      iconId: 'aws:lambda',
      studioBaseUrl: 'http://localhost:4321',
      className: 'sf:h-8 sf:w-8',
    });
    expect(el.type).toBe('img');
    expect(el.props.src).toBe('http://localhost:4321/api/icons/aws/lambda.svg');
    expect(el.props.loading).toBe('lazy');
    expect(el.props.draggable).toBe(false);
    expect(el.props.className).toBe('sf:h-8 sf:w-8');
    // No ariaLabel ⇒ aria-hidden=true and empty alt for decorative usage.
    expect(el.props['aria-hidden']).toBe(true);
    expect(el.props.alt).toBe('');
  });

  it('renders an <img> against a same-origin relative URL when studioBaseUrl is empty', () => {
    const el = callIconRenderer({ iconId: 'gcp:cloud-run', studioBaseUrl: '' });
    expect(el.type).toBe('img');
    expect(el.props.src).toBe('/api/icons/gcp/cloud-run.svg');
  });

  it('renders the HelpCircle placeholder with data-testid when iconId is empty', () => {
    const el = callIconRenderer({ iconId: '', studioBaseUrl: '' });
    expect(el.type).toBe(HelpCircle);
    expect(el.props['data-testid']).toBe('icon-renderer-placeholder');
    expect(el.props['aria-hidden']).toBe(true);
  });

  it('renders the placeholder when the Lucide name is unknown', () => {
    const el = callIconRenderer({
      iconId: 'definitely-not-a-real-icon',
      studioBaseUrl: '',
    });
    expect(el.type).toBe(HelpCircle);
    expect(el.props['data-testid']).toBe('icon-renderer-placeholder');
  });

  it('routes iconify:set:name to the IconifyOrPlaceholder wrapper', () => {
    // The wrapper has its own useState/useEffect so we just assert it's the
    // element type — its render-time fallback path is exercised at runtime,
    // not at the synchronous first-call level we test here.
    const el = callIconRenderer({
      iconId: 'iconify:logos:google-cloud',
      studioBaseUrl: '',
    });
    expect(typeof el.type).toBe('function');
    expect((el.type as { name?: string }).name).toBe('IconifyOrPlaceholder');
  });
});
