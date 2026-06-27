import { describe, expect, it } from 'bun:test';
import {
  CONNECT_BUFFER_BASE_PX,
  CONNECT_BUFFER_MAX_PX,
  connectBufferPx,
} from './connect-buffer.ts';

describe('connectBufferPx', () => {
  it('keeps the base for small nodes', () => {
    expect(connectBufferPx({ width: 40, height: 40 })).toBe(CONNECT_BUFFER_BASE_PX);
  });

  it('grows with node size, up to the cap', () => {
    // 0.25 * 80 = 20 → between base and cap.
    expect(connectBufferPx({ width: 80, height: 80 })).toBe(20);
    // 0.25 * 120 = 30 → capped at the max.
    expect(connectBufferPx({ width: 200, height: 120 })).toBe(CONNECT_BUFFER_MAX_PX);
  });

  it('uses the smaller dimension (a wide thin node stays base)', () => {
    expect(connectBufferPx({ width: 400, height: 40 })).toBe(CONNECT_BUFFER_BASE_PX);
  });

  it('never exceeds the cap and never drops below the base', () => {
    for (const [w, h] of [
      [10, 10],
      [1000, 1000],
      [50, 300],
    ] as const) {
      const b = connectBufferPx({ width: w, height: h });
      expect(b).toBeGreaterThanOrEqual(CONNECT_BUFFER_BASE_PX);
      expect(b).toBeLessThanOrEqual(CONNECT_BUFFER_MAX_PX);
    }
  });

  it('stays under xyflow connectionRadius (32) so handle-snap stays wider', () => {
    expect(CONNECT_BUFFER_MAX_PX).toBeLessThan(32);
  });
});
