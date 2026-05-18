import { describe, expect, it, mock } from 'bun:test';
import { buildIconInsertPayload, computeIconInsertPosition } from '@/lib/icon-insert';
import { ICON_DEFAULT_SIZE } from '@seeflow/canvas';

// Identity-transform stand-in: pans/zooms are no-ops, so the flow-space center
// equals the screen-space center. Keeps the math under test isolated from any
// xyflow internals.
const identityRf = {
  screenToFlowPosition: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }),
};

describe('computeIconInsertPosition', () => {
  it('returns the viewport center in flow space minus half the default icon size', () => {
    const viewport = { width: 1000, height: 800 };
    const pos = computeIconInsertPosition(identityRf, viewport);
    // center = (500, 400); offset by ICON_DEFAULT_SIZE/2 = (24, 24)
    expect(pos).toEqual({
      x: 500 - ICON_DEFAULT_SIZE.width / 2,
      y: 400 - ICON_DEFAULT_SIZE.height / 2,
    });
  });

  it('routes the viewport center through rfInstance.screenToFlowPosition exactly once', () => {
    const screenToFlowPosition = mock((p: { x: number; y: number }) => ({
      x: p.x + 100,
      y: p.y + 200,
    }));
    computeIconInsertPosition({ screenToFlowPosition }, { width: 600, height: 400 });
    expect(screenToFlowPosition).toHaveBeenCalledTimes(1);
    expect(screenToFlowPosition).toHaveBeenCalledWith({ x: 300, y: 200 });
  });

  it('applies the rfInstance transform (pan/zoom) before the half-size offset', () => {
    // Simulate a viewport that has been panned right + down 50px and zoomed 2x.
    // screenToFlowPosition reverses both: (x - panX) / zoom.
    const rf = {
      screenToFlowPosition: (p: { x: number; y: number }) => ({
        x: (p.x - 50) / 2,
        y: (p.y - 50) / 2,
      }),
    };
    const pos = computeIconInsertPosition(rf, { width: 1000, height: 800 });
    // flow center: ((500-50)/2, (400-50)/2) = (225, 175). Minus 24, 24:
    expect(pos).toEqual({ x: 225 - 24, y: 175 - 24 });
  });
});

describe('buildIconInsertPayload', () => {
  it('produces an iconNode payload with the picked name and default size', () => {
    const payload = buildIconInsertPayload({
      iconName: 'shopping-cart',
      rfInstance: identityRf,
      viewport: { width: 800, height: 600 },
    });
    expect(payload).toEqual({
      type: 'iconNode',
      position: {
        x: 400 - ICON_DEFAULT_SIZE.width / 2,
        y: 300 - ICON_DEFAULT_SIZE.height / 2,
      },
      data: {
        icon: 'shopping-cart',
        width: ICON_DEFAULT_SIZE.width,
        height: ICON_DEFAULT_SIZE.height,
      },
    });
  });

  it('forwards the icon name verbatim regardless of case or hyphenation', () => {
    const payload = buildIconInsertPayload({
      iconName: 'A-Arrow-Down',
      rfInstance: identityRf,
      viewport: { width: 100, height: 100 },
    });
    expect(payload.data.icon).toBe('A-Arrow-Down');
  });
});
