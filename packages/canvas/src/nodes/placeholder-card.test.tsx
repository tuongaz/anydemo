import { describe, expect, it } from 'bun:test';
import { PlaceholderCard } from './placeholder-card.tsx';

type ReactElementLike = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

const SAMPLE_MESSAGE = 'Missing: blocks/x.html';

type Props = Parameters<typeof PlaceholderCard>[0];

// PlaceholderCard is a pure function component with no hooks — call it
// directly to get the rendered JSX element.
function callComponent(props: Props): ReactElementLike {
  return (PlaceholderCard as unknown as (p: Props) => ReactElementLike)(props);
}

describe('PlaceholderCard (US-014)', () => {
  it('renders the message as its child', () => {
    const tree = callComponent({ message: SAMPLE_MESSAGE });
    expect(tree.props.children).toBe(SAMPLE_MESSAGE);
  });

  it('exposes data-testid="placeholder-card"', () => {
    const tree = callComponent({ message: 'x' });
    expect((tree.props as { 'data-testid'?: string })['data-testid']).toBe('placeholder-card');
  });

  it('defaults to the muted variant when no variant is passed', () => {
    const tree = callComponent({ message: 'x' });
    expect(
      (tree.props as { 'data-placeholder-variant'?: string })['data-placeholder-variant'],
    ).toBe('muted');
    const className = tree.props.className as string;
    expect(className).toContain('text-muted-foreground');
    expect(className).not.toContain('text-destructive');
  });

  it('renders the destructive variant when requested', () => {
    const tree = callComponent({ message: 'x', variant: 'destructive' });
    expect(
      (tree.props as { 'data-placeholder-variant'?: string })['data-placeholder-variant'],
    ).toBe('destructive');
    const className = tree.props.className as string;
    expect(className).toContain('text-destructive');
  });

  it('preserves the pointer-events-none chrome (placeholders never intercept canvas drags)', () => {
    const tree = callComponent({ message: 'x' });
    const className = tree.props.className as string;
    expect(className).toContain('pointer-events-none');
  });

  it('appends caller-supplied className to the base chrome', () => {
    const tree = callComponent({ message: 'x', className: 'bg-red-100' });
    const className = tree.props.className as string;
    expect(className).toContain('bg-red-100');
  });
});
