import { ExecutorSelectionService } from '../../src/modules/orchestration/services/executor-selection.service';

describe('ExecutorSelectionService capability routing', () => {
  function createService(agents: Array<Record<string, any>>) {
    const agentModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(agents) }),
    };
    const employeeModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };
    const roleModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };

    return new ExecutorSelectionService(
      agentModel as any,
      {} as any,
      employeeModel as any,
      roleModel as any,
    );
  }

  it('infers development.plan required capabilities and avoids exec-only agent', async () => {
    const service = createService([
      {
        _id: 'agent-coder-van',
        id: 'agent-coder-van',
        isActive: true,
        name: 'Coder-Van',
        roleId: 'dev',
        tier: 'operations',
        tools: [],
        capabilities: ['development_exec', 'opencode'],
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
        capabilities: ['development_plan', 'opencode'],
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
});
