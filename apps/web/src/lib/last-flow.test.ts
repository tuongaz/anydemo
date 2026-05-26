import { describe, expect, it } from 'bun:test';
import { LAST_FLOW_STORAGE_KEY_PREFIX, type PickableFlow, pickInitialFlow } from '@/lib/last-flow';

const flow = (flowSlug: string, isDefault = false): PickableFlow => ({ flowSlug, isDefault });

describe('LAST_FLOW_STORAGE_KEY_PREFIX', () => {
  it('matches the documented per-project localStorage key shape', () => {
    expect(LAST_FLOW_STORAGE_KEY_PREFIX).toBe('seeflow:last-flow:');
  });
});

// The acceptance criteria for US-026 calls out the redirect order
// "URL → localStorage → defaultFlow". URL priority is the App.tsx routing
// decision (the picker only runs when the URL has no flow), so these cases
// cover the remaining priority chain that this pure function owns.
describe('pickInitialFlow — URL → localStorage → defaultFlow priority', () => {
  it('returns null when the project has no flows registered yet', () => {
    expect(pickInitialFlow([], null)).toBeNull();
    expect(pickInitialFlow([], 'main')).toBeNull();
  });

  it('prefers the last-flow when it still resolves to a registered flow', () => {
    const flows = [flow('main', true), flow('retry')];
    expect(pickInitialFlow(flows, 'retry')).toBe('retry');
  });

  it('falls back to the default flow when the stored last-flow no longer exists', () => {
    const flows = [flow('main', true), flow('retry')];
    expect(pickInitialFlow(flows, 'deleted')).toBe('main');
  });

  it('falls back to the default flow when no last-flow is stored', () => {
    const flows = [flow('retry'), flow('main', true)];
    expect(pickInitialFlow(flows, null)).toBe('main');
  });

  it('falls back to the first flow when no flow is marked default and no last-flow is stored', () => {
    const flows = [flow('first'), flow('second')];
    expect(pickInitialFlow(flows, null)).toBe('first');
  });

  it('honors last-flow ahead of a different default', () => {
    const flows = [flow('main', true), flow('retry')];
    expect(pickInitialFlow(flows, 'main')).toBe('main');
  });
});
