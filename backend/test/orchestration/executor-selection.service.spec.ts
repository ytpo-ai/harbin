import { ExecutorSelectionService } from '../../src/modules/orchestration/services/executor-selection.service';

describe('ExecutorSelectionService capability routing', () => {
  function createService(agents: Array<Record<string, any>>) {
    const agentModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(agents) }),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
    };
    const employeeModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };
    const roleModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };

    const service = new ExecutorSelectionService(
      agentModel as any,
      {} as any,
      employeeModel as any,
      roleModel as any,
    );

    return {
      service,
      agentModel,
    };
  }

  it('infers development.plan required capabilities and avoids exec-only agent', async () => {
    const { service } = createService([
      {
        _id: 'agent-coder-van',
        id: 'agent-coder-van',
        isActive: true,
        name: 'Coder-Van',
        roleId: 'dev',
        tier: 'operations',
        tools: [],
        capabilities: ['development.exec', 'opencode'],
        config: { execution: { provider: 'opencode' } },
      },
      {
        _id: 'agent-doctor-w',
        id: 'agent-doctor-w',
        isActive: true,
        name: 'Doctor-W',
        roleId: 'dev',
        tier: 'operations',
        tools: [],
        capabilities: ['development.plan', 'opencode'],
        config: { execution: { provider: 'opencode' } },
      },
    ]);

    const result = await service.selectExecutor({
      title: '制定技术开发计划',
      description: '按照 rd-workflow 输出 step1 计划',
      taskType: 'development.plan',
    });

    expect(result.executorType).toBe('agent');
    expect(result.executorId).toBe('agent-doctor-w');
  });

  it('loads agent candidates with project scope + global scope', async () => {
    const { service, agentModel } = createService([
      {
        _id: 'agent-a',
        id: 'agent-a',
        isActive: true,
        name: 'Agent A',
        roleId: 'dev',
        tools: [],
        capabilities: ['general'],
      },
    ]);

    await service.selectExecutor({
      title: '执行任务',
      description: 'project scoped',
      projectId: 'proj-1',
      taskType: 'general',
    });

    expect(agentModel.find).toHaveBeenCalledWith({
      isActive: true,
      $or: [
        { projectId: 'proj-1' },
        { projectId: { $in: [null, ''] } },
        { projectId: { $exists: false } },
      ],
    });
  });

  it('rejects planner-selected agent outside project scope', async () => {
    const agentModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              id: 'agent-outside',
              tools: ['tool-a'],
              config: { execution: { provider: 'opencode' } },
              projectId: 'proj-2',
            }),
          }),
        }),
      }),
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };
    const service = new ExecutorSelectionService(
      agentModel as any,
      { find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }) }) } as any,
      { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) } as any,
      { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) } as any,
    );

    const result = await service.validateAgentToolFit({
      agentId: 'agent-outside',
      taskTitle: '执行开发任务',
      taskDescription: 'step',
      projectId: 'proj-1',
      taskType: 'development.exec',
      requiredTools: ['tool-a'],
    });

    expect(result.fit).toBe(false);
    expect(result.rejectionReason).toBe('project_scope_mismatch');
    expect(result.missingTools).toEqual([]);
  });
});
