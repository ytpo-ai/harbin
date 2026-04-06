import { OrchestrationContextService } from './orchestration-context.service';

describe('OrchestrationContextService inferRuntimeTaskTypeFromPlanContext', () => {
  const service = new OrchestrationContextService({} as any, {} as any, { resolvePrompt: jest.fn() } as any);

  it('uses explicit taskType for review task', () => {
    const runtimeTaskType = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskType: 'development.review',
      taskTitle: 'step5 实现评估（锚定 req-1）',
      taskDescription: '输出评估结论（通过/需修改 + 具体意见）',
    });

    expect(runtimeTaskType).toBe('development.review');
  });

  it('uses explicit taskType for plan task', () => {
    const runtimeTaskType = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskType: 'development.plan',
      taskTitle: 'step3 制定技术开发计划',
      taskDescription: '基于需求规格设计实现方案，拆解开发子任务，评估技术风险',
    });

    expect(runtimeTaskType).toBe('development.plan');
  });

  it('falls back to development.exec when planner omits taskType in development domain', () => {
    const runtimeTaskType = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskTitle: 'step3 制定技术开发计划',
      taskDescription: '基于需求规格设计实现方案',
    });

    expect(runtimeTaskType).toBe('development.exec');
  });

  it('falls back to research for research domain', () => {
    const runtimeTaskType = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'research',
      taskTitle: '调研竞品方案',
      taskDescription: '对比三个竞品的实现方式',
    });

    expect(runtimeTaskType).toBe('research');
  });

  it('falls back to general when domain is general and no taskType', () => {
    const runtimeTaskType = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'general',
      taskTitle: '选定最高优先级需求',
      taskDescription: '从需求池中选择',
    });

    expect(runtimeTaskType).toBe('general');
  });

  it('preserves existingRuntimeTaskType over everything', () => {
    const runtimeTaskType = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskType: 'general',
      existingRuntimeTaskType: 'development.review',
      taskTitle: 'any',
      taskDescription: 'any',
    });

    expect(runtimeTaskType).toBe('development.review');
  });
});

describe('OrchestrationContextService buildPreTaskContext', () => {
  const service = new OrchestrationContextService(
    {} as any,
    {} as any,
    {
      resolvePrompt: jest.fn().mockResolvedValue({
        content: 'pre_execute\n{{preActionsSection}}\n{"allowExecute":true}',
        source: 'code_default',
      }),
    } as any,
  );

  it('builds prompt with preExecuteActions tool call templates', async () => {
    const prompt = await service.buildPreTaskContext({
      step: 1,
      taskId: 'task-1',
      taskTitle: 'step1',
      taskDescription: 'desc',
      taskContext: { requirementId: 'req-123' },
      preExecuteActions: [
        { tool: 'builtin.engineering.mcp.requirement.update-status', params: { requirementId: 'req-123', status: 'in_progress' } },
      ],
    });

    expect(prompt).toContain('pre_execute');
    expect(prompt).toContain('builtin.engineering.mcp.requirement.update-status');
    expect(prompt).toContain('allowExecute');
  });
});

describe('OrchestrationContextService buildPostTaskContext', () => {
  const service = new OrchestrationContextService(
    {} as any,
    {} as any,
    {
      resolvePrompt: jest.fn().mockResolvedValue({
        content: '{{decisionRulesSection}}\n{{progressSection}}\npost_execute',
        source: 'code_default',
      }),
    } as any,
  );

  it('uses system decision rules for multi-step development plan', async () => {
    const prompt = await service.buildPostTaskContext({
      step: 1,
      taskId: 'task-1',
      taskTitle: 'step1',
      executionStatus: 'completed',
      executionOutput: 'ok',
      planDomainType: 'development',
      totalGeneratedSteps: 1,
      outlineStepCount: 3,
    });

    expect(prompt).toContain('generate_next');
    expect(prompt).toContain('post_execute');
    expect(prompt).toContain('1/3');
  });

  it('returns stop decision rule when all steps completed', async () => {
    const prompt = await service.buildPostTaskContext({
      step: 3,
      taskId: 'task-3',
      taskTitle: 'step3',
      executionStatus: 'completed',
      executionOutput: 'review done',
      planDomainType: 'development',
      totalGeneratedSteps: 3,
      outlineStepCount: 3,
    });

    expect(prompt).toContain('stop');
    expect(prompt).toContain('全部 3 步已完成');
  });
});
