import { IncrementalPlanningService } from '../../src/modules/orchestration/services/incremental-planning.service';

describe('IncrementalPlanningService redesign task lookup', () => {
  function createService(taskModelOverrides?: Record<string, any>) {
    const taskModel = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
      findById: jest.fn(),
      ...taskModelOverrides,
    };

    const planModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ strategy: { plannerAgentId: 'planner-agent-1' } }),
          }),
        }),
      }),
    };

    const service = new IncrementalPlanningService(
      planModel as any,
      taskModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        refreshPlanStats: jest.fn().mockResolvedValue(undefined),
        syncPlanSessionTasks: jest.fn().mockResolvedValue(undefined),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    jest.spyOn(service as any, 'resolveAssignmentForPlannerTask').mockResolvedValue({
      executorType: 'agent',
      executorId: 'agent-2',
      reason: 'test',
    });

    return { service, taskModel };
  }

  it('accepts non-ObjectId redesignTaskId by matching task.id', async () => {
    const targetTask = {
      _id: '65f0a2b0c8b5f65b0a12de34',
      runtimeTaskType: 'general',
      assignment: { executorId: 'agent-1' },
    };

    const { service, taskModel } = createService({
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(targetTask) }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...targetTask, title: 'updated' }),
      }),
    });

    const result = await (service as any).redesignFailedTask('plan-1', 'task-91f3602b-fd3a-4c0a-b9e1-fc43cd77925f', {
      title: 'retry import',
      description: 'use alternate agent',
      priority: 'urgent',
      agentId: 'agent-2',
      requiredTools: ['repo-read'],
    });

    expect(taskModel.findOne).toHaveBeenCalledWith({
      planId: 'plan-1',
      status: 'failed',
      $or: [{ id: 'task-91f3602b-fd3a-4c0a-b9e1-fc43cd77925f' }],
    });
    expect(result).toEqual(expect.objectContaining({ title: 'updated' }));
  });
});
