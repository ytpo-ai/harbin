import { OrchestrationStepDispatcherService } from '../../src/modules/orchestration/services/orchestration-step-dispatcher.service';

describe('OrchestrationStepDispatcherService', () => {
  function createService(findOneAndUpdateResult: any) {
    const exec = jest.fn().mockResolvedValue(findOneAndUpdateResult);
    const lean = jest.fn().mockReturnValue({ exec });
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean });

    const service = new OrchestrationStepDispatcherService(
      {
        findOneAndUpdate,
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, findOneAndUpdate };
  }

  function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('updates generation state only when expected phase matches', async () => {
    const { service, findOneAndUpdate } = createService({ _id: 'plan-1' });

    const result = await (service as any).updateGenerationStateIfExpected(
      'plan-1',
      {
        currentStep: 1,
        totalGenerated: 1,
        totalRetries: 0,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalCost: 100,
        isComplete: false,
        currentPhase: 'pre_execute',
        currentTaskId: 'task-1',
      },
      {
        currentStep: 1,
        totalGenerated: 1,
        totalRetries: 0,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalCost: 100,
        isComplete: false,
        currentPhase: 'executing',
        currentTaskId: 'task-1',
      },
    );

    expect(result).toBe(true);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'plan-1',
        'generationState.currentPhase': 'pre_execute',
        'generationState.isComplete': false,
        'generationState.currentTaskId': 'task-1',
      },
      expect.any(Object),
      { new: false },
    );
  });

  it('returns false when compare-and-set does not match', async () => {
    const { service } = createService(null);

    const result = await (service as any).updateGenerationStateIfExpected(
      'plan-1',
      {
        currentStep: 0,
        totalGenerated: 0,
        totalRetries: 0,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalCost: 0,
        isComplete: false,
        currentPhase: 'idle',
      },
      {
        currentStep: 0,
        totalGenerated: 0,
        totalRetries: 0,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalCost: 0,
        isComplete: false,
        currentPhase: 'generating',
      },
    );

    expect(result).toBe(false);
  });

  it('skips advance when targetPhase does not match current phase', async () => {
    const findById = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'plan-1',
        sourcePrompt: 'prompt',
        generationConfig: {},
        generationState: {
          currentStep: 1,
          totalGenerated: 1,
          totalRetries: 0,
          consecutiveFailures: 0,
          totalFailures: 0,
          totalCost: 0,
          isComplete: false,
          currentPhase: 'pre_execute',
        },
      }),
    });
    const plannerService = {
      generateNextTask: jest.fn(),
    } as any;
    const agentClientService = {
      getOrCreatePlanSession: jest.fn(),
      archiveSession: jest.fn(),
    } as any;

    const service = new OrchestrationStepDispatcherService(
      {
        findById,
      } as any,
      {} as any,
      plannerService,
      {} as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      agentClientService,
    );

    const result = await service.advanceOnce('plan-1', {
      source: 'api',
      targetPhase: 'executing',
    });

    expect(result).toEqual({ advanced: false, phase: 'pre_execute' });
    expect(agentClientService.getOrCreatePlanSession).not.toHaveBeenCalled();
    expect(plannerService.generateNextTask).not.toHaveBeenCalled();
  });

  it('archives planner session when plan already complete', async () => {
    const findById = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'plan-1',
        sourcePrompt: 'prompt',
        generationConfig: {},
        generationState: {
          currentStep: 3,
          totalGenerated: 3,
          totalRetries: 0,
          consecutiveFailures: 0,
          totalFailures: 0,
          totalCost: 100,
          isComplete: true,
          currentPhase: 'idle',
          plannerSessionId: 'planner-session-1',
        },
      }),
    });
    const agentClientService = {
      getOrCreatePlanSession: jest.fn(),
      archiveSession: jest.fn().mockResolvedValue({}),
    } as any;

    const service = new OrchestrationStepDispatcherService(
      {
        findById,
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      agentClientService,
    );

    const result = await service.advanceOnce('plan-1', {
      source: 'internal',
    });

    expect(result).toEqual({ advanced: false, phase: 'idle' });
    expect(agentClientService.archiveSession).toHaveBeenCalledWith('planner-session-1');
    expect(agentClientService.getOrCreatePlanSession).not.toHaveBeenCalled();
  });

  it('prevents concurrent internal and external advance from both progressing', async () => {
    const planDoc = {
      _id: 'plan-1',
      title: 'plan',
      sourcePrompt: 'prompt',
      strategy: { plannerAgentId: 'planner-1' },
      generationConfig: {},
      generationState: {
        currentStep: 0,
        totalGenerated: 0,
        totalRetries: 0,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalCost: 0,
        isComplete: false,
        currentPhase: 'idle',
      },
    };
    const planModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(planDoc),
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(planDoc) }),
      }),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    } as any;

    const service = new OrchestrationStepDispatcherService(
      planModel,
      {} as any,
      {} as any,
      {
        resolveGenerationConfig: jest.fn().mockReturnValue({
          maxTasks: 10,
          maxCostTokens: 100000,
          maxRetries: 3,
          maxTotalFailures: 6,
        }),
      } as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      {
        getOrCreatePlanSession: jest.fn().mockResolvedValue({ id: 'planner-session-1' }),
        archiveSession: jest.fn(),
      } as any,
    );

    const gate = createDeferred<void>();
    jest.spyOn(service as any, 'updateGenerationStateIfExpected').mockResolvedValue(true);
    jest.spyOn(service as any, 'phaseGenerate').mockImplementation(() => gate.promise);

    const internalPromise = service.advanceOnce('plan-1', { source: 'internal' });
    const externalResult = await service.advanceOnce('plan-1', { source: 'api' });

    expect(externalResult).toEqual({ advanced: false });

    gate.resolve();
    const internalResult = await internalPromise;
    expect(internalResult).toEqual({ advanced: true, phase: 'generating' });
    expect((service as any).phaseGenerate).toHaveBeenCalledTimes(1);
  });

  it('blocks execute phase when pre-execution decision disallows execution', async () => {
    const taskUpdateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    const findOneAndUpdate = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'plan-1' }) }),
    });
    const service = new OrchestrationStepDispatcherService(
      {
        findById: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'plan-1',
            title: 'plan',
            sourcePrompt: 'prompt',
            strategy: { plannerAgentId: 'planner-1' },
            generationConfig: {},
            generationState: {
              currentStep: 1,
              totalGenerated: 1,
              totalRetries: 0,
              consecutiveFailures: 0,
              totalFailures: 0,
              totalCost: 0,
              isComplete: false,
              currentPhase: 'pre_execute',
              currentTaskId: 'task-1',
              plannerSessionId: 'planner-session-1',
            },
          }),
        }),
        findOneAndUpdate,
      } as any,
      {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'task-1',
            title: 'do task',
            description: 'desc',
            runtimeTaskType: 'general',
          }),
        }),
        updateOne: taskUpdateOne,
      } as any,
      {
        executePreTask: jest.fn().mockResolvedValue({ allowExecute: false, notes: 'risk too high' }),
      } as any,
      {
        resolveGenerationConfig: jest.fn().mockReturnValue({
          maxTasks: 10,
          maxCostTokens: 100000,
          maxRetries: 3,
          maxTotalFailures: 6,
        }),
        executeIncrementalTaskWithRunRecord: jest.fn(),
      } as any,
      {
        emitPlanStreamEvent: jest.fn(),
      } as any,
      {
        buildPreTaskContext: jest.fn().mockReturnValue('pre-task-context'),
      } as any,
      { emit: jest.fn() } as any,
      {
        getOrCreatePlanSession: jest.fn(),
        archiveSession: jest.fn(),
      } as any,
    );

    jest.spyOn(service as any, 'autoAdvance').mockResolvedValue(undefined);

    const result = await service.advanceOnce('plan-1', { source: 'internal' });

    expect(result).toEqual({ advanced: true, phase: 'pre_execute' });
    expect(taskUpdateOne).toHaveBeenCalled();
    expect((service as any).incrementalPlanningService.executeIncrementalTaskWithRunRecord).not.toHaveBeenCalled();
  });

  it('downgrades post phase to stop when post-task decision fails to parse', async () => {
    const service = new OrchestrationStepDispatcherService(
      {} as any,
      {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'task-1',
            status: 'failed',
            title: 'do task',
            result: { error: 'boom' },
          }),
        }),
      } as any,
      {
        executePostTask: jest.fn().mockRejectedValue(new Error('invalid json')),
      } as any,
      {} as any,
      {
        emitPlanStreamEvent: jest.fn(),
      } as any,
      {
        buildPostTaskContext: jest.fn().mockReturnValue('post-context'),
      } as any,
      { emit: jest.fn() } as any,
      {} as any,
    );

    const completeAndArchiveSpy = jest.spyOn(service as any, 'completeAndArchive').mockResolvedValue(undefined);

    await (service as any).phasePostExecute(
      'plan-1',
      {
        currentStep: 2,
        totalGenerated: 2,
        totalRetries: 0,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalCost: 0,
        isComplete: false,
        currentPhase: 'post_execute',
        currentTaskId: 'task-1',
      },
      'planner-session-1',
    );

    expect(completeAndArchiveSpy).toHaveBeenCalled();
  });

  it('keeps retry decision in post phase when execution failed', async () => {
    const service = new OrchestrationStepDispatcherService(
      {} as any,
      {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'task-1',
            status: 'failed',
            title: 'do task',
            result: { error: 'boom' },
          }),
        }),
      } as any,
      {
        executePostTask: jest.fn().mockResolvedValue({
          nextAction: 'retry',
          reason: 'retry after failure',
        }),
      } as any,
      {} as any,
      {
        emitPlanStreamEvent: jest.fn(),
      } as any,
      {
        buildPostTaskContext: jest.fn().mockReturnValue('post-context'),
      } as any,
      { emit: jest.fn() } as any,
      {} as any,
    );

    const updateStateSpy = jest.spyOn(service as any, 'updateGenerationStateIfExpected').mockResolvedValue(true);
    jest.spyOn(service as any, 'autoAdvance').mockResolvedValue(undefined);

    await (service as any).phasePostExecute(
      'plan-1',
      {
        currentStep: 2,
        totalGenerated: 2,
        totalRetries: 0,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalCost: 0,
        isComplete: false,
        currentPhase: 'post_execute',
        currentTaskId: 'task-1',
      },
      'planner-session-1',
    );

    expect(updateStateSpy).toHaveBeenCalledWith(
      'plan-1',
      expect.any(Object),
      expect.objectContaining({
        currentPhase: 'pre_execute',
        lastDecision: 'retry',
      }),
    );
  });

  it('applies redesign decision and resets to idle for next round generation', async () => {
    const service = new OrchestrationStepDispatcherService(
      {} as any,
      {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'task-1',
            status: 'failed',
            title: 'do task',
            result: { error: 'boom' },
          }),
        }),
      } as any,
      {
        executePostTask: jest.fn().mockResolvedValue({
          nextAction: 'redesign',
          reason: 'rebuild failed task',
          redesignTaskId: 'task-1',
        }),
      } as any,
      {} as any,
      {
        emitPlanStreamEvent: jest.fn(),
      } as any,
      {
        buildPostTaskContext: jest.fn().mockReturnValue('post-context'),
      } as any,
      { emit: jest.fn() } as any,
      {} as any,
    );

    const updateStateSpy = jest.spyOn(service as any, 'updateGenerationStateIfExpected').mockResolvedValue(true);
    jest.spyOn(service as any, 'autoAdvance').mockResolvedValue(undefined);

    await (service as any).phasePostExecute(
      'plan-1',
      {
        currentStep: 2,
        totalGenerated: 2,
        totalRetries: 0,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalCost: 0,
        isComplete: false,
        currentPhase: 'post_execute',
        currentTaskId: 'task-1',
      },
      'planner-session-1',
    );

    expect(updateStateSpy).toHaveBeenCalledWith(
      'plan-1',
      expect.any(Object),
      expect.objectContaining({
        currentPhase: 'idle',
        currentTaskId: undefined,
        lastDecision: 'redesign',
      }),
    );
  });
});
