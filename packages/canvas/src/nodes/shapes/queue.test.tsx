import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueueShape } from './queue.tsx';

describe('QueueShape', () => {
  it('pads the viewBox so the boundary-aligned pill stroke is not clipped', () => {
    const html = renderToStaticMarkup(<QueueShape width={100} height={60} borderSize={2} />);
    expect(html).toContain('viewBox="-2 -2 104 64"');
  });
});
