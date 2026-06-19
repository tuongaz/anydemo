import { describe, expect, it } from 'bun:test';
import { userInitials } from '@/components/user-menu';

describe('userInitials', () => {
  it('uses the first letters of the first two name words', () => {
    expect(userInitials({ name: 'Ada Lovelace' })).toBe('AL');
    expect(userInitials({ name: 'grace  hopper' })).toBe('GH');
  });

  it('falls back to the first two chars of a single-word name', () => {
    expect(userInitials({ name: 'Madonna' })).toBe('MA');
  });

  it('uses the email when there is no name', () => {
    expect(userInitials({ email: 'tester@seeflow.dev' })).toBe('TE');
  });

  it('returns ? when there is no name or email', () => {
    expect(userInitials({})).toBe('?');
    expect(userInitials({ name: '   ' })).toBe('?');
  });
});
