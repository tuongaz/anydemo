import { describe, expect, it } from 'bun:test';
import { PlayButton } from './play-button.tsx';

describe('PlayButton (extracted module)', () => {
  it('is exported as a function named "PlayButton"', () => {
    // The rectangle-node test suite locates the component via
    // findByComponentName(tree, 'PlayButton'). Renaming would silently
    // break that matcher; pin the function name here.
    expect(typeof PlayButton).toBe('function');
    expect((PlayButton as { name: string }).name).toBe('PlayButton');
  });
});
