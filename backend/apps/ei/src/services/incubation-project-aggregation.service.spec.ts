import { NotFoundException } from '@nestjs/common';
import { IncubationProjectAggregationService } from './incubation-project-aggregation.service';

describe('IncubationProjectAggregationService', () => {
  function createService(overrides?: {
    projectExists?: boolean;
    discussionSpaces?: any[];
    discussionAgg?: Array<{ _id: string | null; count: number }>;
  }) {
    const projectModel = {
      exists: jest.fn().mockResolvedValue(overrides?.projectExists ?? true),
    };

    const discussionSpaces = overrides?.discussionSpaces ?? [];
    const discussionFindExec = jest.fn().mockResolvedValue(discussionSpaces);
    const discussionFindLean = jest.fn().mockReturnValue({ exec: discussionFindExec });
    const discussionFindSort = jest.fn().mockReturnValue({ lean: discussionFindLean });
    const discussionFind = jest.fn().mockReturnValue({ sort: discussionFindSort });

    const discussionAgg = overrides?.discussionAgg ?? [];

    const discussionSpaceModel = {
      find: discussionFind,
      aggregate: jest.fn().mockResolvedValue(discussionAgg),
    };

    const aggregateEmpty = jest.fn().mockResolvedValue([]);

    const scheduleModel = {
      countDocuments: jest.fn().mockImplementation((query: { enabled?: boolean }) => ({
        exec: jest.fn().mockResolvedValue(query?.enabled ? 2 : 5),
      })),
    };

    const service = new IncubationProjectAggregationService(
      projectModel as any,
      { aggregate: aggregateEmpty } as any,
      { aggregate: aggregateEmpty } as any,
      { aggregate: aggregateEmpty } as any,
      scheduleModel as any,
      { aggregate: aggregateEmpty } as any,
      discussionSpaceModel as any,
      { aggregate: aggregateEmpty } as any,
      { getAllAgents: jest.fn().mockResolvedValue([]) } as any,
    );

    return { service, projectModel, discussionFind, discussionSpaceModel };
  }

  it('maps discussion _id to id in project discussions', async () => {
    const { service, discussionFind } = createService({
      discussionSpaces: [
        {
          _id: 'space-001',
          title: 'Web3 观察',
          category: 'industry_observation',
          status: 'active',
          tags: ['web3'],
          statistics: { totalMessages: 12, totalKnowledgeEntries: 3 },
          createdAt: new Date('2026-04-30T10:00:00.000Z'),
          updatedAt: new Date('2026-04-30T12:00:00.000Z'),
        },
      ],
    });

    const result = await service.getProjectDiscussionSpaces('project-001');

    expect(discussionFind).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('space-001');
    expect(result[0].title).toBe('Web3 观察');
  });

  it('throws not found when project does not exist', async () => {
    const { service } = createService({ projectExists: false });

    await expect(service.getProjectDiscussionSpaces('missing-project')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns discussion stats grouped by category', async () => {
    const { service, discussionSpaceModel } = createService({
      discussionAgg: [
        { _id: 'industry_observation', count: 2 },
        { _id: null, count: 1 },
      ],
    });

    const result = await service.getProjectStats('project-001');

    expect(discussionSpaceModel.aggregate).toHaveBeenCalled();
    expect(result.discussions.total).toBe(3);
    expect(result.discussions.byCategory.industry_observation).toBe(2);
    expect(result.discussions.byCategory.general).toBe(1);
  });
});
