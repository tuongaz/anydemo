import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentShape } from './document.tsx';

describe('DocumentShape', () => {
  it('pads the viewBox so the boundary-aligned top/side strokes are not clipped', () => {
    const html = renderToStaticMarkup(<DocumentShape width={100} height={60} borderSize={2} />);
    expect(html).toContain('viewBox="-2 -2 104 64"');
  });
});
