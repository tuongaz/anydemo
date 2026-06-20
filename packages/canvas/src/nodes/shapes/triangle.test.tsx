import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TriangleShape } from './triangle.tsx';

describe('TriangleShape', () => {
  it('pads the viewBox so the boundary-aligned base stroke is not clipped', () => {
    const html = renderToStaticMarkup(<TriangleShape width={100} height={60} borderSize={2} />);
    expect(html).toContain('viewBox="-2 -2 104 64"');
  });
});
