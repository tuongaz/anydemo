import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatabaseShape } from './database.tsx';

describe('DatabaseShape', () => {
  it('pads the viewBox so the full-width ellipse rim stroke is not clipped', () => {
    const html = renderToStaticMarkup(<DatabaseShape width={100} height={60} borderSize={2} />);
    expect(html).toContain('viewBox="-2 -2 104 64"');
  });
});
