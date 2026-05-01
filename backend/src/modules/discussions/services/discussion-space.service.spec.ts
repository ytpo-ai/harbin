import { DiscussionSpaceStatus } from '../../../shared/schemas/discussion-space.schema';
import { buildListSpacesFilter } from './discussion-space.service';

describe('discussion space list filter', () => {
  it('excludes archived spaces by default', () => {
    const filter = buildListSpacesFilter({});
    expect(filter).toEqual({
      status: { $ne: DiscussionSpaceStatus.ARCHIVED },
    });
  });

  it('keeps explicit status query unchanged', () => {
    const filter = buildListSpacesFilter({
      status: DiscussionSpaceStatus.ARCHIVED,
      includeArchived: false,
    });

    expect(filter).toEqual({
      status: DiscussionSpaceStatus.ARCHIVED,
    });
  });

  it('includes archived spaces when includeArchived enabled', () => {
    const filter = buildListSpacesFilter({
      includeArchived: true,
      creatorId: 'user-1',
      tags: ['alpha', 'beta'],
    });

    expect(filter).toEqual({
      creatorId: 'user-1',
      tags: { $in: ['alpha', 'beta'] },
    });
  });
});
