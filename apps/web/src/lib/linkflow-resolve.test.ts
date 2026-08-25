import { describe, expect, it } from 'bun:test';
import type { FlowSummary } from '@/lib/api';
import { resolveLinkflowTarget } from './linkflow-resolve.ts';

function makeSummary(slug: string, name: string): FlowSummary {
  const [project = '', flow = ''] = slug.split('/');
  return {
    id: `flow-${project}-${flow}`,
    slug,
    name,
    repoPath: `/repo/${project}/${flow}`,
    lastModified: 0,
    valid: true,
  };
}

describe('resolveLinkflowTarget (US-008)', () => {
  const flows: FlowSummary[] = [
    makeSummary('sample/orders', 'Orders Flow'),
    makeSummary('marketing/landing', 'Landing Page'),
  ];

  it('returns null when target is undefined (unlinked state caller branch)', () => {
    expect(resolveLinkflowTarget(undefined, flows)).toBeNull();
  });

  it('returns {projectName, flowName} when the target slug pair matches a known flow', () => {
    const resolved = resolveLinkflowTarget({ project: 'sample', flow: 'orders' }, flows);
    expect(resolved).toEqual({ projectName: 'sample', flowName: 'Orders Flow' });
  });

  it('returns null when the target project is unknown (broken state)', () => {
    const resolved = resolveLinkflowTarget({ project: 'ghost', flow: 'orders' }, flows);
    expect(resolved).toBeNull();
  });

  it('returns null when the target flow is unknown within a known project (broken state)', () => {
    const resolved = resolveLinkflowTarget({ project: 'sample', flow: 'missing' }, flows);
    expect(resolved).toBeNull();
  });

  it('returns null when the flows list is empty', () => {
    const resolved = resolveLinkflowTarget({ project: 'sample', flow: 'orders' }, []);
    expect(resolved).toBeNull();
  });

  it('uses the project slug as projectName (FlowSummary has no separate project label)', () => {
    const resolved = resolveLinkflowTarget({ project: 'marketing', flow: 'landing' }, flows);
    expect(resolved?.projectName).toBe('marketing');
  });

  it('resolves against the flow name from the cache, not the target slug', () => {
    const resolved = resolveLinkflowTarget({ project: 'marketing', flow: 'landing' }, flows);
    expect(resolved?.flowName).toBe('Landing Page');
  });
});
