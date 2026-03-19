import { IdentityAggregationService } from './identity-aggregation.service';

const queryResult = (value: any) => ({
  exec: jest.fn().mockResolvedValue(value),
});

describe('IdentityAggregationService', () => {
  const createService = () => {
    const agentModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
    };
    const skillModel = {
      find: jest.fn(),
    };
    const memoModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      create: jest.fn(),
    };

    const service = new IdentityAggregationService(
      agentModel as any,
      skillModel as any,
      memoModel as any,
    );

    return {
      service,
      agentModel,
      skillModel,
      memoModel,
    };
  };

  it('renders agent name and tool id list in capability section', async () => {
    const { service, agentModel, memoModel } = createService();

    agentModel.findById.mockReturnValue(
      queryResult({
        id: 'agent-1',
        name: 'Kim CTO',
        type: 'cto',
        roleId: 'role-cto',
        description: '技术负责人',
        systemPrompt: '负责技术架构与工程交付',
        tools: ['internal.web.search'],
        skills: [],
        capabilities: ['analysis'],
        personality: { workEthic: 90, creativity: 85, leadership: 88, teamwork: 92 },
        learningAbility: 86,
        isActive: true,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    );
    memoModel.findOne.mockReturnValue(queryResult({ id: 'memo-1', version: 1 }));
    memoModel.findOneAndUpdate.mockReturnValue(queryResult({ id: 'memo-1' }));

    await service.aggregateIdentity('agent-1');

    const updatePayload = memoModel.findOneAndUpdate.mock.calls[0][1];
    const content = updatePayload.$set.content;
    expect(content).toContain('**Agent 名称**：Kim CTO');
    expect(content).toContain('## 能力域');
    expect(content).toContain('- **工具集（ID 列表）**：');
    expect(content).toContain('  - internal.web.search');
    expect(content).not.toContain('### 工具描述');
  });

  it('keeps unknown tools and removes duplicate tool ids', async () => {
    const { service, agentModel, memoModel } = createService();

    agentModel.findById.mockReturnValue(
      queryResult({
        id: 'agent-2',
        name: 'Alex',
        type: 'assistant',
        roleId: 'role-assistant',
        description: '',
        systemPrompt: '',
        tools: ['unknown.tool', 'unknown.tool', '  unknown.tool  '],
        skills: [],
        capabilities: [],
        isActive: true,
        createdAt: new Date('2026-03-02T00:00:00.000Z'),
      }),
    );
    memoModel.findOne.mockReturnValue(queryResult(null));
    memoModel.create.mockResolvedValue({ id: 'memo-new' });

    await service.aggregateIdentity('agent-2');

    const createPayload = memoModel.create.mock.calls[0][0];
    const content = createPayload.content;
    expect(content).toContain('**Agent 名称**：Alex');
    expect(content).toContain('  - unknown.tool');
    expect(content.match(/ {2}- unknown\.tool/g)?.length).toBe(1);
  });
});
