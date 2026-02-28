import { NotFoundException } from '@nestjs/common';
import { AgentService } from './agent.service';

declare const describe: any;
declare const it: any;
declare const expect: any;
declare const jest: any;

describe('AgentService MCP', () => {
  const createService = () => {
    const mockModel = {};
    const mockAgentProfileModel = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    const mockModelService = {};
    const mockApiKeyService = {};
    const mockToolService = {
      getToolsByIds: jest.fn(),
    };

    const service = new AgentService(
      mockModel as any,
      mockAgentProfileModel as any,
      mockModelService as any,
      mockApiKeyService as any,
      mockToolService as any,
    );

    return { service, mockToolService };
  };

  it('returns only exposed agents by default', async () => {
    const { service, mockToolService } = createService();
    mockToolService.getToolsByIds.mockResolvedValue([
      {
        id: 'websearch',
        name: 'Web Search',
        description: 'Search web information',
        type: 'web_search',
        category: 'Information Retrieval',
      },
    ]);

    jest.spyOn(service, 'getAllAgents').mockResolvedValue([
      {
        id: 'a1',
        name: 'CEO',
        type: 'ai-executive',
        description: 'Executive',
        model: {} as any,
        capabilities: ['leadership'],
        systemPrompt: 'x',
        isActive: true,
        tools: ['websearch'],
        permissions: [],
        personality: { workEthic: 1, creativity: 1, leadership: 1, teamwork: 1 },
        learningAbility: 1,
      },
      {
        id: 'a2',
        name: 'Support',
        type: 'ai-support',
        description: 'Support',
        model: {} as any,
        capabilities: ['faq_resolution'],
        systemPrompt: 'y',
        isActive: true,
        tools: [],
        permissions: [],
        personality: { workEthic: 1, creativity: 1, leadership: 1, teamwork: 1 },
        learningAbility: 1,
      },
    ] as any);

    const result = await service.getMcpAgents();

    expect(result.total).toBe(2);
    expect(result.visible).toBe(1);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].id).toBe('a1');
    expect(result.agents[0].role).toBe('executive-strategist');
    expect(result.agents[0].toolSet[0].id).toBe('websearch');
  });

  it('can include hidden agents with includeHidden flag', async () => {
    const { service, mockToolService } = createService();
    mockToolService.getToolsByIds.mockResolvedValue([]);

    jest.spyOn(service, 'getAllAgents').mockResolvedValue([
      {
        id: 'a2',
        name: 'Support',
        type: 'ai-support',
        description: 'Support',
        model: {} as any,
        capabilities: [],
        systemPrompt: 'y',
        isActive: true,
        tools: [],
        permissions: [],
        personality: { workEthic: 1, creativity: 1, leadership: 1, teamwork: 1 },
        learningAbility: 1,
      },
    ] as any);

    const result = await service.getMcpAgents({ includeHidden: true });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].exposed).toBe(false);
  });

  it('throws not found when hidden profile is requested without includeHidden', async () => {
    const { service, mockToolService } = createService();
    mockToolService.getToolsByIds.mockResolvedValue([]);

    jest.spyOn(service, 'getAgent').mockResolvedValue({
      id: 'a2',
      name: 'Support',
      type: 'ai-support',
      description: 'Support',
      model: {} as any,
      capabilities: [],
      systemPrompt: 'y',
      isActive: true,
      tools: [],
      permissions: [],
      personality: { workEthic: 1, creativity: 1, leadership: 1, teamwork: 1 },
      learningAbility: 1,
    } as any);

    await expect(service.getMcpAgent('a2')).rejects.toBeInstanceOf(NotFoundException);
  });
});
