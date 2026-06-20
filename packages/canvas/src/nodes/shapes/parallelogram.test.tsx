import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ParallelogramShape } from './parallelogram.tsx';

describe('ParallelogramShape', () => {
  it('pads the viewBox so the boundary-aligned edge strokes are not clipped', () => {
    const html = renderToStaticMarkup(
      <ParallelogramShape width={100} height={60} borderSize={2} />,
    );
    expect(html).toContain('viewBox="-2 -2 104 64"');
  });
});
