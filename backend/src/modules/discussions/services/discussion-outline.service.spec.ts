import { DiscussionOutlineService } from './discussion-outline.service';
import { DiscussionSpaceCategory } from '../../../shared/schemas/discussion-space.schema';

describe('DiscussionOutlineService', () => {
  const buildService = () => {
    const discussionSpaceModel = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
    } as any;
    const discussionKnowledgeEntryModel = {
      aggregate: jest.fn(),
    } as any;
    const discussionKnowledgeService = {} as any;
    const agentClientService = {
      getAgent: jest.fn(),
      getActiveAgents: jest.fn(),
      executeTaskDetailed: jest.fn(),
    } as any;

    const service = new DiscussionOutlineService(
      discussionSpaceModel,
      discussionKnowledgeEntryModel,
      discussionKnowledgeService,
      agentClientService,
    );

    return {
      service,
      discussionSpaceModel,
      agentClientService,
    };
  };

  it('uses agent JSON output for outline generation', async () => {
    const { service, discussionSpaceModel, agentClientService } = buildService();
    const space = {
      id: 'space-1',
      title: 'Web3 行业观察',
      category: DiscussionSpaceCategory.INDUSTRY_OBSERVATION,
      metadata: { industryContext: '区块链 Web3' },
      settings: { defaultReplyAgentId: 'agent-1' },
      documentOutline: { version: 1, title: '旧大纲', sections: [] },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(space),
    });
    discussionSpaceModel.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(undefined),
    });

    agentClientService.getAgent.mockResolvedValue({ id: 'agent-1', isActive: true });
    agentClientService.executeTaskDetailed.mockResolvedValue({
      response: JSON.stringify({
        title: 'Web3 行业观察大纲',
        sections: [
          {
            id: 'sec-1',
            title: '行业发展脉络',
            description: '梳理关键阶段和里程碑',
            order: 0,
            depth: 0,
          },
        ],
      }),
      runId: 'run-1',
      sessionId: 'session-1',
    });

    const outline = await service.generateOutline('space-1', { industryContext: '区块链 Web3' });

    expect(outline.generatedBy).toBe('agent');
    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0].title).toBe('行业发展脉络');
    expect(outline.runId).toBe('run-1');
    expect(outline.sessionId).toBe('session-1');
    expect(outline.agentId).toBe('agent-1');
  });

  it('falls back to default outline when runtime fails', async () => {
    const { service, discussionSpaceModel, agentClientService } = buildService();
    const space = {
      id: 'space-1',
      title: 'Web3 行业观察',
      category: DiscussionSpaceCategory.INDUSTRY_OBSERVATION,
      metadata: { industryContext: '区块链 Web3' },
      settings: { defaultReplyAgentId: 'agent-1' },
      documentOutline: { version: 1, title: '旧大纲', sections: [] },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(space),
    });
    discussionSpaceModel.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(undefined),
    });

    agentClientService.getAgent.mockResolvedValue({ id: 'agent-1', isActive: true });
    agentClientService.executeTaskDetailed.mockRejectedValue(new Error('runtime unavailable'));

    const outline = await service.generateOutline('space-1', { industryContext: '区块链 Web3' });

    expect(outline.generatedBy).toBe('hybrid');
    expect(outline.sections.length).toBeGreaterThan(0);
    expect(outline.sections[0].title).toContain('发展脉络');
  });

  it('computes outline knowledge coverage with section details', async () => {
    const { service, discussionSpaceModel } = buildService();

    discussionSpaceModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          id: 'space-1',
          title: 'Web3 行业观察',
          documentOutline: {
            version: 1,
            title: 'Web3 行业观察大纲',
            sections: [
              { id: 'sec-1', title: '行业发展脉络', order: 0, depth: 0, status: 'sufficient', knowledgeCount: 5, childSectionIds: [] },
              { id: 'sec-2', title: '核心公司图谱', order: 1, depth: 0, status: 'draft', knowledgeCount: 0, childSectionIds: [] },
              { id: 'sec-3', title: '关键数据指标追踪', order: 2, depth: 0, status: 'enriching', knowledgeCount: 1, childSectionIds: [] },
            ],
            generatedBy: 'agent',
            createdAt: new Date('2026-04-30T00:00:00.000Z'),
            updatedAt: new Date('2026-04-30T00:00:00.000Z'),
          },
        }),
      }),
    });

    (service as any).discussionKnowledgeEntryModel.aggregate.mockResolvedValue([
      { _id: 'sec-1', knowledgeCount: 6, latestEntryDate: '2026-04-30T08:00:00.000Z' },
      { _id: 'sec-3', knowledgeCount: 2, latestEntryDate: '2026-04-30T09:00:00.000Z' },
    ]);

    const coverage = await service.getKnowledgeCoverage('space-1');

    expect(coverage.totalSections).toBe(3);
    expect(coverage.coveredSections).toBe(2);
    expect(coverage.sufficientSections).toBe(1);
    expect(coverage.coverage).toBeCloseTo(0.6667, 4);
    expect(coverage.sectionDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sectionId: 'sec-1', knowledgeCount: 6, status: 'sufficient' }),
        expect.objectContaining({ sectionId: 'sec-2', knowledgeCount: 0, status: 'draft' }),
        expect.objectContaining({ sectionId: 'sec-3', knowledgeCount: 2, status: 'enriching' }),
      ]),
    );
  });
});
