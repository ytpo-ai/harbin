import { OrchestrationContextService } from './orchestration-context.service';

describe('OrchestrationContextService inferRuntimeTaskTypeFromPlanContext', () => {
  const service = new OrchestrationContextService({} as any, {} as any, { buildResearchOutputContract: jest.fn() } as any);

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

describe('OrchestrationContextService phase prompt injection', () => {
  const service = new OrchestrationContextService({} as any, {} as any, { buildResearchOutputContract: jest.fn() } as any);

  it('uses pre_execute phase prompt when provided', () => {
    const prompt = service.buildPreTaskContext({
      step: 1,
      taskId: 'task-1',
      taskTitle: 'step1',
      taskDescription: 'desc',
      outlineStep: {
        phasePrompts: {
          pre_execute: '必须先核验输入再放行',
        },
      },
    });

    expect(prompt).toContain('必须先核验输入再放行');
    expect(prompt).toContain('allowExecute');
  });

  it('uses post_execute phase prompt when provided', () => {
    const prompt = service.buildPostTaskContext({
      step: 1,
      taskId: 'task-1',
      taskTitle: 'step1',
      executionStatus: 'completed',
      executionOutput: 'ok',
      postExecutePrompt: '若输出证据充分则 generate_next，否则 redesign',
    });

    expect(prompt).toContain('若输出证据充分则 generate_next，否则 redesign');
  });
});
