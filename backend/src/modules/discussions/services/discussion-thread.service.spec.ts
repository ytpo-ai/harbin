import { canCreateBranch } from './discussion-thread.service';

describe('discussion-thread branching', () => {
  it('allows branching when max depth is undefined', () => {
    expect(canCreateBranch(undefined, 12)).toBe(true);
  });

  it('allows branching at configured depth boundary', () => {
    expect(canCreateBranch(2, 1)).toBe(true);
  });

  it('rejects branching when parent depth exceeds limit', () => {
    expect(canCreateBranch(2, 2)).toBe(false);
  });
});
