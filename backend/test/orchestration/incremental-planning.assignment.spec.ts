import { IncrementalPlanningService } from '../../src/modules/orchestration/services/incremental-planning.service';

describe('IncrementalPlanningService assignment routing', () => {
  function createService(overrides?: {
    selectExecutor?: jest.Mock;
    createTaskFromPlannerOutput?: jest.Mock;
  }) {
    const planModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ generationState: { currentStep: 0 } }),
          }),
        }),
      }),
    };
    const taskModel = {
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({ order: 0 }),
            }),
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
      { refreshPlanStats: jest.fn(), syncPlanSessionTasks: jest.fn() } as any,
      {} as any,
      {} as any,
      { selectExecutor: overrides?.selectExecutor || jest.fn() } as any,
    );

    if (overrides?.createTaskFromPlannerOutput) {
      jest.spyOn(service, 'createTaskFromPlannerOutput').mockImplementation(overrides.createTaskFromPlannerOutput as any);
    }

    return service;
  }

  it('passes inferred requiredCapabilities into fallback executor selection', async () => {
    const selectExecutor = jest.fn().mockResolvedValue({
      executorType: 'agent',
      executorId: 'agent-doctor-w',
      reason: 'ok',
    });
    const service = createService({ selectExecutor });

    const result = await (service as any).resolveFallbackAssignment(
      {
        title: '制定技术开发计划',
        description: 'step1',
        priority: 'high',
        taskType: 'development.plan',
      },
      'Planner did not provide valid agentId',
    );

    expect(selectExecutor).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'development.plan',
      requiredCapabilities: ['development_plan', 'opencode'],
    }));
    expect(result.executorId).toBe('agent-doctor-w');
  });

  it('accepts executorId alias in submit-task payload', async () => {
    const createTaskFromPlannerOutput = jest.fn().mockResolvedValue({
      _id: 'task-1',
      title: 'step1',
      description: 'desc',
      status: 'assigned',
      priority: 'high',
      order: 1,
      assignment: { executorType: 'agent', executorId: 'agent-doctor-w' },
      taskType: 'development.plan',
    });
    const service = createService({ createTaskFromPlannerOutput });

    await service.submitPlannerTaskFromTool({
      planId: '507f1f77bcf86cd799439011',
      action: 'new',
      title: 'step1',
      description: 'desc',
      priority: 'high',
      taskType: 'development.plan',
      executorId: 'agent-doctor-w',
    });

    expect(createTaskFromPlannerOutput).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      expect.objectContaining({ agentId: 'agent-doctor-w' }),
      1,
    );
  });
});
