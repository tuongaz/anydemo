import { describe, expect, it } from 'bun:test';
import type { StatusReport } from '../../types.ts';
import { deriveVisualStatus } from './visual-status.ts';

describe('deriveVisualStatus', () => {
  it('returns idle when status is undefined and no report', () => {
    expect(deriveVisualStatus(undefined, undefined)).toBe('idle');
  });

  it('returns idle when status is "idle" and no report', () => {
    expect(deriveVisualStatus('idle', undefined)).toBe('idle');
  });

  it('maps "running" status to active', () => {
    expect(deriveVisualStatus('running', undefined)).toBe('active');
  });

  it('maps "done" status to success', () => {
    expect(deriveVisualStatus('done', undefined)).toBe('success');
  });

  it('maps "error" status to error', () => {
    expect(deriveVisualStatus('error', undefined)).toBe('error');
  });

  it('treats pending statusReport as active even when run status is idle', () => {
    const report: StatusReport = { state: 'pending' };
    expect(deriveVisualStatus(undefined, report)).toBe('active');
    expect(deriveVisualStatus('idle', report)).toBe('active');
  });

  it('treats ok statusReport as success when run status is idle/undefined', () => {
    const report: StatusReport = { state: 'ok' };
    expect(deriveVisualStatus(undefined, report)).toBe('success');
    expect(deriveVisualStatus('idle', report)).toBe('success');
  });

  it('treats error statusReport as error regardless of run status', () => {
    const report: StatusReport = { state: 'error' };
    expect(deriveVisualStatus(undefined, report)).toBe('error');
    expect(deriveVisualStatus('idle', report)).toBe('error');
    expect(deriveVisualStatus('done', report)).toBe('error');
    expect(deriveVisualStatus('running', report)).toBe('error');
  });

  it('treats warn statusReport as idle (not surfaced as its own state in v1)', () => {
    // warn is intentionally not part of VisualStatus — the four-state
    // model is idle | active | success | error. warn reports still appear
    // in the footer StatusBadge; the pill stays idle.
    const report: StatusReport = { state: 'warn' };
    expect(deriveVisualStatus(undefined, report)).toBe('idle');
    expect(deriveVisualStatus('idle', report)).toBe('idle');
  });

  it('priority: run "error" beats report "pending"', () => {
    expect(deriveVisualStatus('error', { state: 'pending' })).toBe('error');
  });

  it('priority: report "pending" beats run "done" (re-checking after completion)', () => {
    // A done run followed by a fresh pending status check should read as
    // active again — the user wants to see the new check is running.
    expect(deriveVisualStatus('done', { state: 'pending' })).toBe('active');
  });

  it('priority: run "running" beats report "ok"', () => {
    expect(deriveVisualStatus('running', { state: 'ok' })).toBe('active');
  });

  it('priority: run "done" + report "ok" stays success', () => {
    expect(deriveVisualStatus('done', { state: 'ok' })).toBe('success');
  });
});
