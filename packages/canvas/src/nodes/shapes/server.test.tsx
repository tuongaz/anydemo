import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServerShape } from './server.tsx';

describe('ServerShape', () => {
  it('pads the viewBox so the boundary-aligned chassis stroke is not clipped', () => {
    const html = renderToStaticMarkup(<ServerShape width={100} height={60} borderSize={2} />);
    expect(html).toContain('viewBox="-2 -2 104 64"');
  });
});
