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
      countDocuments: jest.fn(),
      find: jest.fn(),
      deleteMany: jest.fn(),
    } as any;
    const discussionParticipantModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
    } as any;
    const discussionKnowledgeService = {
      createKnowledgeEntry: jest.fn(),
    } as any;
    const agentClientService = {
      getAgent: jest.fn(),
      getActiveAgents: jest.fn().mockResolvedValue([]),
      executeTaskDetailed: jest.fn(),
    } as any;

    const service = new DiscussionOutlineService(
      discussionSpaceModel,
      discussionKnowledgeEntryModel,
      discussionParticipantModel,
      discussionKnowledgeService,
      agentClientService,
    );

    return {
      service,
      discussionSpaceModel,
      discussionKnowledgeEntryModel,
      discussionParticipantModel,
      discussionKnowledgeService,
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

    agentClientService.getAgent.mockResolvedValue({ id: 'agent-1', isActive: true, roleCode: 'industry-research' });
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

    agentClientService.getAgent.mockResolvedValue({ id: 'agent-1', isActive: true, roleCode: 'industry-research' });
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
               { id: 'sec-2', title: '核心公司图谱', order: 1, depth: 0, status: 'sufficient', knowledgeCount: 3, childSectionIds: [] },
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

  it('enriches section with runtime knowledge entries', async () => {
    const {
      service,
      discussionSpaceModel,
      discussionKnowledgeEntryModel,
      discussionKnowledgeService,
      agentClientService,
    } = buildService();

    const space = {
      id: 'space-1',
      title: 'Web3 行业观察',
      category: DiscussionSpaceCategory.INDUSTRY_OBSERVATION,
      metadata: { industryContext: '区块链 Web3' },
      settings: { defaultReplyAgentId: 'agent-1' },
      documentOutline: {
        version: 1,
        title: 'Web3 行业观察大纲',
        sections: [
          {
            id: 'sec-1',
            title: '核心公司图谱',
            description: '关注头部公司表现',
            order: 0,
            depth: 0,
            status: 'draft',
            knowledgeCount: 0,
            childSectionIds: [],
            metadata: {
              isStructuredData: true,
            },
          },
        ],
      },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(space),
      }),
    });
    discussionKnowledgeEntryModel.countDocuments.mockResolvedValue(0);
    discussionKnowledgeEntryModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    agentClientService.getAgent.mockResolvedValue({ id: 'agent-1', isActive: true, roleCode: 'industry-research' });
    agentClientService.executeTaskDetailed.mockResolvedValue({
      response: JSON.stringify({
        entries: [
          {
            title: 'Coinbase 2026Q1 营收',
            content: 'Coinbase 披露 2026Q1 营收同比增长 32%。',
            summary: 'Coinbase 营收增长 32%',
            entryType: 'data_point',
            sourceUrl: 'https://example.com/coinbase-q1',
            sourceName: 'Company Filing',
            credibility: 'medium',
          },
          {
            title: 'Binance 现货份额变化',
            content: 'Binance 在主要交易对现货份额保持领先。',
            summary: 'Binance 份额领先',
            entryType: 'fact',
            sourceUrl: 'https://example.com/binance-share',
            sourceName: 'Market Report',
            credibility: 'medium',
          },
          {
            title: 'Kraken 国际扩张',
            content: 'Kraken 在欧洲市场新增合规牌照。',
            summary: 'Kraken 欧盟扩张',
            entryType: 'fact',
            sourceUrl: 'https://example.com/kraken-eu',
            sourceName: 'News',
            credibility: 'medium',
          },
        ],
      }),
    });

    const result = await service.enrichSection('space-1', 'sec-1');

    expect(agentClientService.executeTaskDetailed).toHaveBeenCalledTimes(1);
    expect(discussionKnowledgeService.createKnowledgeEntry).toHaveBeenCalledTimes(3);
    expect(discussionKnowledgeService.createKnowledgeEntry).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({
        title: 'Coinbase 2026Q1 营收',
        outlineSectionId: 'sec-1',
        entryType: 'data_point',
        sourceType: 'web_search',
      }),
    );
    expect(result.enrichedCount).toBe(3);
  });

  it('creates fallback entries aligned with addCount when agent returns non-json', async () => {
    const {
      service,
      discussionSpaceModel,
      discussionKnowledgeEntryModel,
      discussionKnowledgeService,
      agentClientService,
    } = buildService();

    const space = {
      id: 'space-1',
      title: 'Web3 行业观察',
      category: DiscussionSpaceCategory.INDUSTRY_OBSERVATION,
      metadata: { industryContext: '区块链 Web3' },
      settings: { defaultReplyAgentId: 'agent-1' },
      documentOutline: {
        version: 1,
        title: 'Web3 行业观察大纲',
        sections: [
          {
            id: 'sec-1',
            title: '关键人物与组织',
            description: '关注关键角色与组织关系',
            order: 0,
            depth: 0,
            status: 'draft',
            knowledgeCount: 0,
            childSectionIds: [],
            metadata: {
              isStructuredData: false,
            },
          },
        ],
      },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(space),
      }),
    });
    discussionKnowledgeEntryModel.countDocuments.mockResolvedValue(0);
    discussionKnowledgeEntryModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    agentClientService.getAgent.mockResolvedValue({ id: 'agent-1', isActive: true, roleCode: 'industry-research' });
    agentClientService.executeTaskDetailed.mockResolvedValue({
      response: '我建议从公司公告与媒体报道中交叉验证关键人物关系。',
    });

    const result = await service.enrichSection('space-1', 'sec-1');

    expect(result.enrichedCount).toBe(3);
    expect(result.enrichmentMeta).toEqual(
      expect.objectContaining({
        mode: 'fallback',
        fallbackReason: 'agent_response_non_json',
        acceptedAgentEntries: 0,
        createdFallbackEntries: 3,
      }),
    );
    expect(discussionKnowledgeService.createKnowledgeEntry).toHaveBeenCalledTimes(3);
    expect(discussionKnowledgeService.createKnowledgeEntry).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({
        sourceName: 'outline-enricher-fallback',
      }),
    );
  });

  it('accepts balanced json embedded in plain text response', async () => {
    const {
      service,
      discussionSpaceModel,
      discussionKnowledgeEntryModel,
      discussionKnowledgeService,
      agentClientService,
    } = buildService();

    const space = {
      id: 'space-1',
      title: 'Web3 行业观察',
      category: DiscussionSpaceCategory.INDUSTRY_OBSERVATION,
      metadata: { industryContext: '区块链 Web3' },
      settings: { defaultReplyAgentId: 'agent-1' },
      documentOutline: {
        version: 1,
        title: 'Web3 行业观察大纲',
        sections: [
          {
            id: 'sec-1',
            title: '关键人物与组织',
            description: '关注关键角色与组织关系',
            order: 0,
            depth: 0,
            status: 'draft',
            knowledgeCount: 0,
            childSectionIds: [],
            metadata: {
              isStructuredData: false,
            },
          },
        ],
      },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(space),
      }),
    });
    discussionKnowledgeEntryModel.countDocuments.mockResolvedValue(0);
    discussionKnowledgeEntryModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    agentClientService.getAgent.mockResolvedValue({ id: 'agent-1', isActive: true, roleCode: 'industry-research' });
    agentClientService.executeTaskDetailed.mockResolvedValue({
      response: [
        '以下是条目：',
        '{"entries":[{"title":"观察A","content":"内容A","summary":"摘要A","entryType":"analysis"}]}',
        '请核验。',
      ].join('\n'),
    });

    const result = await service.enrichSection('space-1', 'sec-1');

    expect(result.enrichedCount).toBe(1);
    expect(result.enrichmentMeta).toEqual(
      expect.objectContaining({
        mode: 'agent',
        acceptedAgentEntries: 1,
        createdFallbackEntries: 0,
      }),
    );
    expect(discussionKnowledgeService.createKnowledgeEntry).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({
        sourceName: 'outline-enricher-runtime',
      }),
    );
  });

  it('uses runtime plain text response as knowledge when no json is provided', async () => {
    const {
      service,
      discussionSpaceModel,
      discussionKnowledgeEntryModel,
      discussionKnowledgeService,
      agentClientService,
    } = buildService();

    const space = {
      id: 'space-1',
      title: 'Web3 行业观察',
      category: DiscussionSpaceCategory.INDUSTRY_OBSERVATION,
      metadata: { industryContext: '区块链 Web3' },
      settings: { defaultReplyAgentId: 'agent-1' },
      documentOutline: {
        version: 1,
        title: 'Web3 行业观察大纲',
        sections: [
          {
            id: 'sec-1',
            title: '关键人物与组织',
            description: '关注关键角色与组织关系',
            order: 0,
            depth: 0,
            status: 'draft',
            knowledgeCount: 0,
            childSectionIds: [],
            metadata: {
              isStructuredData: false,
            },
          },
        ],
      },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(space),
      }),
    });
    discussionKnowledgeEntryModel.countDocuments.mockResolvedValue(0);
    discussionKnowledgeEntryModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    agentClientService.getAgent.mockResolvedValue({ id: 'agent-1', isActive: true, roleCode: 'industry-research' });
    agentClientService.executeTaskDetailed.mockResolvedValue({
      response:
        '关键组织之间的合作关系已经从技术联盟扩展到供应链协同，建议优先核验头部机构的联合公告与季度经营披露，重点关注资本动作和关键岗位流动。',
    });

    const result = await service.enrichSection('space-1', 'sec-1');

    expect(result.enrichedCount).toBe(1);
    expect(result.enrichmentMeta).toEqual(
      expect.objectContaining({
        mode: 'agent',
        acceptedAgentEntries: 1,
        createdFallbackEntries: 0,
      }),
    );
    expect(discussionKnowledgeService.createKnowledgeEntry).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({
        sourceName: 'outline-enricher-runtime-plain',
      }),
    );
  });

  it('falls back when runtime plain text is clarification question', async () => {
    const {
      service,
      discussionSpaceModel,
      discussionKnowledgeEntryModel,
      discussionKnowledgeService,
      agentClientService,
    } = buildService();

    const space = {
      id: 'space-1',
      title: 'Web3 行业观察',
      category: DiscussionSpaceCategory.INDUSTRY_OBSERVATION,
      metadata: { industryContext: '区块链 Web3' },
      settings: { defaultReplyAgentId: 'agent-1' },
      documentOutline: {
        version: 1,
        title: 'Web3 行业观察大纲',
        sections: [
          {
            id: 'sec-1',
            title: '关键人物与组织',
            description: '关注关键角色与组织关系',
            order: 0,
            depth: 0,
            status: 'draft',
            knowledgeCount: 0,
            childSectionIds: [],
            metadata: {
              isStructuredData: false,
            },
          },
        ],
      },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(space),
      }),
    });
    discussionKnowledgeEntryModel.countDocuments.mockResolvedValue(0);
    discussionKnowledgeEntryModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    agentClientService.getAgent.mockResolvedValue({ id: 'agent-1', isActive: true, roleCode: 'industry-research' });
    agentClientService.executeTaskDetailed.mockResolvedValue({
      response:
        '请告诉我你想讨论的具体问题/产出形式，我再直接给结论与框架。你可以按下面任一方式提需求（选一条就够）：1）时间线脉络？',
    });

    const result = await service.enrichSection('space-1', 'sec-1');

    expect(result.enrichedCount).toBe(3);
    expect(result.enrichmentMeta).toEqual(
      expect.objectContaining({
        mode: 'fallback',
      }),
    );
    expect(agentClientService.executeTaskDetailed).toHaveBeenCalledTimes(2);
    expect(discussionKnowledgeService.createKnowledgeEntry).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({
        sourceName: 'outline-enricher-fallback',
      }),
    );
  });

  it('prefers industry research agent over default reply participant agent', async () => {
    const {
      service,
      discussionSpaceModel,
      discussionKnowledgeEntryModel,
      discussionParticipantModel,
      discussionKnowledgeService,
      agentClientService,
    } = buildService() as any;

    const space = {
      id: 'space-1',
      title: 'Web3 行业观察',
      description: '跟踪能源与资本市场变化',
      category: DiscussionSpaceCategory.INDUSTRY_OBSERVATION,
      metadata: { industryContext: '全球能源' },
      projectId: 'project-1',
      settings: { defaultReplyAgentId: 'participant-cto' },
      documentOutline: {
        version: 1,
        title: 'Web3 行业观察大纲',
        sections: [
          {
            id: 'sec-1',
            title: '全球能源 发展脉络',
            order: 0,
            depth: 0,
            status: 'draft',
            knowledgeCount: 0,
            childSectionIds: [],
            metadata: { isStructuredData: false },
          },
        ],
      },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(space),
      }),
    });
    discussionParticipantModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ id: 'participant-cto', agentId: 'cto-agent-1' }),
      }),
    });
    discussionKnowledgeEntryModel.countDocuments.mockResolvedValue(0);
    discussionKnowledgeEntryModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    agentClientService.getAgent.mockResolvedValue({
      id: 'cto-agent-1',
      isActive: true,
      name: 'Kim-CTO',
      roleCode: 'cto',
      agentType: 'management',
    });
    agentClientService.getActiveAgents.mockResolvedValue([
      {
        id: 'research-agent-1',
        isActive: true,
        name: '行业研究助手',
        roleCode: 'industry-research',
        agentType: 'industry-research',
      },
    ]);
    agentClientService.executeTaskDetailed.mockResolvedValue({
      response: '{"entries":[{"title":"观察A","content":"内容A","entryType":"analysis"}]}',
    });

    await service.enrichSection('space-1', 'sec-1');

    expect(agentClientService.executeTaskDetailed).toHaveBeenCalledWith(
      'research-agent-1',
      expect.any(Object),
      expect.any(Object),
    );
    expect(discussionKnowledgeService.createKnowledgeEntry).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({
        sourceName: 'outline-enricher-runtime',
      }),
    );
  });

  it('prefers project web-research-capable agent when research role is unavailable', async () => {
    const {
      service,
      discussionSpaceModel,
      discussionKnowledgeEntryModel,
      discussionParticipantModel,
      discussionKnowledgeService,
      agentClientService,
    } = buildService() as any;

    const space = {
      id: 'space-1',
      title: '能源观察',
      description: '跟踪能源行业动态',
      category: DiscussionSpaceCategory.INDUSTRY_OBSERVATION,
      metadata: { industryContext: '全球能源' },
      projectId: 'project-1',
      settings: { defaultReplyAgentId: 'participant-cto' },
      documentOutline: {
        version: 1,
        title: '能源观察大纲',
        sections: [
          {
            id: 'sec-1',
            title: '全球能源 发展脉络',
            order: 0,
            depth: 0,
            status: 'draft',
            knowledgeCount: 0,
            childSectionIds: [],
            metadata: { isStructuredData: false },
          },
        ],
      },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(space),
      }),
    });
    discussionParticipantModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ id: 'participant-cto', agentId: 'cto-agent-1' }),
      }),
    });
    discussionKnowledgeEntryModel.countDocuments.mockResolvedValue(0);
    discussionKnowledgeEntryModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    agentClientService.getAgent.mockResolvedValue({
      id: 'cto-agent-1',
      isActive: true,
      name: 'Kim-CTO',
      roleCode: 'cto',
      agentType: 'management',
    });
    agentClientService.getActiveAgents.mockResolvedValue([
      {
        id: 'energy-owner-1',
        isActive: true,
        name: 'EnergyMarketRadar-Owner',
        description: '能源行业观察负责人',
        tools: [
          'builtin.data-gathering.internal.web.search-exa',
          'builtin.data-gathering.internal.web.fetch',
        ],
      },
    ]);
    agentClientService.executeTaskDetailed.mockResolvedValue({
      response: '{"entries":[{"title":"观察A","content":"内容A","entryType":"analysis"}]}',
    });

    await service.enrichSection('space-1', 'sec-1');

    expect(agentClientService.executeTaskDetailed).toHaveBeenCalledWith(
      'energy-owner-1',
      expect.any(Object),
      expect.any(Object),
    );
    expect(discussionKnowledgeService.createKnowledgeEntry).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({
        sourceName: 'outline-enricher-runtime',
      }),
    );
  });

  it('deletes section subtree with bound knowledge entries', async () => {
    const { service, discussionSpaceModel, discussionKnowledgeEntryModel } = buildService();

    const space = {
      id: 'space-1',
      title: 'Web3 行业观察',
      documentOutline: {
        version: 2,
        title: 'Web3 行业观察大纲',
        sections: [
          { id: 'sec-1', title: '一级章节', order: 0, depth: 0, status: 'draft', knowledgeCount: 0, childSectionIds: ['sec-1-1'] },
          {
            id: 'sec-1-1',
            title: '子章节',
            order: 0,
            depth: 1,
            parentSectionId: 'sec-1',
            status: 'draft',
            knowledgeCount: 0,
            childSectionIds: [],
          },
          { id: 'sec-2', title: '保留章节', order: 1, depth: 0, status: 'draft', knowledgeCount: 0, childSectionIds: [] },
        ],
      },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(space),
      }),
    });
    discussionSpaceModel.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(undefined),
    });
    discussionKnowledgeEntryModel.deleteMany.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 4 }),
    });

    const result = await service.deleteSection('space-1', 'sec-1');

    expect(discussionKnowledgeEntryModel.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-1',
        outlineSectionId: { $in: expect.arrayContaining(['sec-1', 'sec-1-1']) },
      }),
    );
    expect(result.deletedSectionIds).toEqual(expect.arrayContaining(['sec-1', 'sec-1-1']));
    expect(result.deletedKnowledgeCount).toBe(4);
    expect(result.outline.sections.map((item) => item.id)).toEqual(['sec-2']);
  });

  it('clears section enrichment knowledge while keeping section', async () => {
    const { service, discussionSpaceModel, discussionKnowledgeEntryModel } = buildService();

    const space = {
      id: 'space-1',
      title: 'Web3 行业观察',
      documentOutline: {
        version: 3,
        title: 'Web3 行业观察大纲',
        sections: [
          { id: 'sec-1', title: '一级章节', order: 0, depth: 0, status: 'draft', knowledgeCount: 3, childSectionIds: [] },
        ],
      },
    };

    discussionSpaceModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(space),
      }),
    });
    discussionSpaceModel.updateOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(undefined),
    });
    discussionKnowledgeEntryModel.deleteMany.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    });
    discussionKnowledgeEntryModel.countDocuments.mockResolvedValue(0);

    const result = await service.clearSectionEnrichment('space-1', 'sec-1');

    expect(discussionKnowledgeEntryModel.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-1',
        outlineSectionId: 'sec-1',
        sourceType: { $ne: 'user_input' },
      }),
    );
    expect(result.clearedKnowledgeCount).toBe(2);
    expect(result.outline.sections.map((item) => item.id)).toEqual(['sec-1']);
    expect(result.outline.sections[0]?.knowledgeCount).toBe(0);
    expect(result.outline.sections[0]?.status).toBe('draft');
  });
});
