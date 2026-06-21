import { describe, expect, it } from 'bun:test';
import { hasUnconfirmedEdits } from './unsaved-edits.ts';

const ZERO = {
  nodeOverrides: 0,
  connectorOverrides: 0,
  nodeDeletions: 0,
  connectorDeletions: 0,
};

describe('hasUnconfirmedEdits', () => {
  it('is false when nothing is pending', () => {
    expect(hasUnconfirmedEdits(ZERO)).toBe(false);
  });

  it('is true when a node override is pending', () => {
    expect(hasUnconfirmedEdits({ ...ZERO, nodeOverrides: 1 })).toBe(true);
  });

  it('is true when a connector override is pending', () => {
    expect(hasUnconfirmedEdits({ ...ZERO, connectorOverrides: 2 })).toBe(true);
  });

  it('is true when a node deletion is pending', () => {
    expect(hasUnconfirmedEdits({ ...ZERO, nodeDeletions: 1 })).toBe(true);
  });

  it('is true when a connector deletion is pending', () => {
    expect(hasUnconfirmedEdits({ ...ZERO, connectorDeletions: 3 })).toBe(true);
  });

  it('is true when several kinds are pending at once', () => {
    expect(
      hasUnconfirmedEdits({
        nodeOverrides: 1,
        connectorOverrides: 1,
        nodeDeletions: 1,
        connectorDeletions: 1,
      }),
    ).toBe(true);
  });
});
