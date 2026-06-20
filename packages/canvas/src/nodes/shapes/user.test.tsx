import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserShape } from './user.tsx';

describe('UserShape', () => {
  it('pads the viewBox so the boundary-aligned torso bottom stroke is not clipped', () => {
    const html = renderToStaticMarkup(<UserShape width={100} height={60} borderSize={2} />);
    expect(html).toContain('viewBox="-2 -2 104 64"');
  });
});
