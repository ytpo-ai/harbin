import { PlanManagementService } from '../../src/modules/orchestration/services/plan-management.service';

describe('PlanManagementService', () => {
  const originalDispatcherFlag = process.env.ORCH_STEP_DISPATCHER_ENABLED;

  afterEach(() => {
    process.env.ORCH_STEP_DISPATCHER_ENABLED = originalDispatcherFlag;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function createService(overrides?: {
    planFindOneResult?: any;
    runFindOneResult?: any;
  }) {
    const orchestrationPlanModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(
          overrides?.planFindOneResult || {
            _id: 'plan-1',
            generationMode: 'incremental',
            generationState: { isComplete: false, currentPhase: 'idle' },
            strategy: { plannerAgentId: 'planner-1', mode: 'hybrid', runMode: 'multi' },
            generationConfig: {
              maxRetries: 3,
              maxTotalFailures: 6,
              maxCostTokens: 500000,
              maxTasks: 15,
            },
            metadata: {},
            title: 'Plan',
            sourcePrompt: 'prompt',
          },
        ),
      }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    const orchestrationTaskModel = {
      deleteMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }),
    };
    const planSessionModel = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    };
    const orchestrationRunModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(overrides?.runFindOneResult || null) }),
        }),
      }),
    };
    const planStatsService = {
      setPlanStatus: jest.fn().mockResolvedValue(undefined),
      setPlanSessionStatus: jest.fn().mockResolvedValue(undefined),
      syncPlanSessionTasks: jest.fn().mockResolvedValue(undefined),
      normalizePlanStatus: jest.fn((status: string) => status),
    };
    const contextService = {
      resolveRequirementIdFromPlan: jest.fn().mockReturnValue(undefined),
    };
    const planEventStreamService = {
      emitPlanStreamEvent: jest.fn(),
    };
    const incrementalPlanningService = {
      executeIncrementalPlanning: jest.fn().mockResolvedValue(undefined),
      executeSinglePlanningStep: jest.fn().mockResolvedValue(undefined),
    };
    const stepDispatcher = {
      advanceOnce: jest.fn().mockResolvedValue({ advanced: true }),
    };
    const agentClientService = {
      archiveSession: jest.fn().mockResolvedValue(undefined),
      getOrCreatePlanSession: jest.fn().mockResolvedValue({ id: 'planner-session-replan-1' }),
    };

    const service = new PlanManagementService(
      orchestrationPlanModel as any,
      orchestrationTaskModel as any,
      planSessionModel as any,
      orchestrationRunModel as any,
      planStatsService as any,
      contextService as any,
      planEventStreamService as any,
      incrementalPlanningService as any,
      stepDispatcher as any,
      agentClientService as any,
    );

    return {
      service,
      orchestrationPlanModel,
      orchestrationTaskModel,
      planSessionModel,
      planStatsService,
      incrementalPlanningService,
      stepDispatcher,
      agentClientService,
    };
  }

  it('keeps legacy incremental path when dispatcher switch is off in startGeneration', async () => {
    process.env.ORCH_STEP_DISPATCHER_ENABLED = 'false';
    jest.useFakeTimers();
    const { service, incrementalPlanningService, stepDispatcher } = createService();

    const result = await service.startGeneration('plan-1');
    await jest.runAllTimersAsync();

    expect(result).toEqual({ accepted: true });
    expect(incrementalPlanningService.executeIncrementalPlanning).toHaveBeenCalledWith('plan-1');
    expect(stepDispatcher.advanceOnce).not.toHaveBeenCalled();
  });

  it('uses dispatcher path when switch is on in generateNext', async () => {
    process.env.ORCH_STEP_DISPATCHER_ENABLED = 'true';
    jest.useFakeTimers();
    const { service, incrementalPlanningService, stepDispatcher } = createService();

    const result = await service.generateNext('plan-1');
    await jest.runAllTimersAsync();

    expect(result).toEqual({ accepted: true });
    expect(stepDispatcher.advanceOnce).toHaveBeenCalledWith('plan-1', { source: 'api' });
    expect(incrementalPlanningService.executeSinglePlanningStep).not.toHaveBeenCalled();
  });

  it('archives old planner session and creates a new one during replan', async () => {
    const { service, orchestrationPlanModel } = createService({
      planFindOneResult: {
        _id: 'plan-1',
        title: 'Old Plan',
        sourcePrompt: 'old prompt',
        status: 'draft',
        taskIds: [],
        strategy: { plannerAgentId: 'planner-1', mode: 'hybrid', runMode: 'multi' },
        generationConfig: {
          maxRetries: 3,
          maxTotalFailures: 6,
          maxCostTokens: 500000,
          maxTasks: 15,
        },
        generationState: {
          isComplete: false,
          currentPhase: 'idle',
          plannerSessionId: 'planner-session-old',
        },
        metadata: {},
      },
    });

    jest.spyOn(service, 'getPlanById').mockResolvedValue({ _id: 'plan-1' } as any);

    const archiveSpy = jest.spyOn(service as any, 'archivePlannerSessionForReplan');
    const createSpy = jest
      .spyOn(service as any, 'createPlannerSessionForReplan')
      .mockResolvedValue('planner-session-replan-1');

    await service.replanPlan('plan-1', {
      prompt: 'new plan prompt',
      autoGenerate: false,
    } as any);

    expect(archiveSpy).toHaveBeenCalledWith('planner-session-old');
    expect(createSpy).toHaveBeenCalledWith('plan-1', 'Old Plan', 'planner-1');
    expect(orchestrationPlanModel.updateOne).toHaveBeenCalledWith(
      { _id: 'plan-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          generationState: expect.objectContaining({
            plannerSessionId: 'planner-session-replan-1',
          }),
        }),
      }),
    );
  });
});
