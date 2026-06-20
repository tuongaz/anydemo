import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HexagonShape } from './hexagon.tsx';

describe('HexagonShape', () => {
  it('pads the viewBox so the top/bottom edge strokes are not clipped', () => {
    const html = renderToStaticMarkup(<HexagonShape width={100} height={60} borderSize={2} />);
    expect(html).toContain('viewBox="-2 -2 104 64"');
  });
});
