import { canCreateBranch, collectThreadSubtreeIds, DiscussionThreadService } from './discussion-thread.service';

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

describe('collectThreadSubtreeIds', () => {
  it('collects root and all descendant thread ids', () => {
    const ids = collectThreadSubtreeIds('t-2', [
      { id: 't-1' },
      { id: 't-2', parentThreadId: 't-1' },
      { id: 't-3', parentThreadId: 't-2' },
      { id: 't-4', parentThreadId: 't-2' },
      { id: 't-5', parentThreadId: 't-4' },
      { id: 't-6', parentThreadId: 't-1' },
    ] as any);

    expect(new Set(ids)).toEqual(new Set(['t-2', 't-3', 't-4', 't-5']));
  });

  it('returns root id even when no descendants exist', () => {
    const ids = collectThreadSubtreeIds('solo', [{ id: 'solo' }] as any);
    expect(ids).toEqual(['solo']);
  });
});

describe('getOrCreateSectionThread', () => {
  it('returns existing section thread when present', async () => {
    const discussionThreadModel = {
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ id: 'thread-sec-1', outlineSectionId: 'sec-1', title: '章节A' }),
          }),
        }),
      }),
    } as any;
    const service = new DiscussionThreadService(
      discussionThreadModel,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.getOrCreateSectionThread('space-1', 'sec-1', '章节A');

    expect(result.id).toBe('thread-sec-1');
    expect(discussionThreadModel.findOne).toHaveBeenCalledWith({
      spaceId: 'space-1',
      outlineSectionId: 'sec-1',
    });
  });
});
