import { OrchestrationContextService } from './orchestration-context.service';

describe('OrchestrationContextService inferRuntimeTaskTypeFromPlanContext', () => {
  const service = new OrchestrationContextService({} as any, {} as any, { buildResearchOutputContract: jest.fn() } as any);

  it('uses taskType when provided for review task', () => {
    const runtimeTaskType = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskType: 'development.review',
      taskTitle: 'step5 实现评估（锚定 req-1）',
      taskDescription: '输出评估结论（通过/需修改 + 具体意见）',
    });

    expect(runtimeTaskType).toBe('development.review');
  });

  it('uses taskType when provided for plan task', () => {
    const runtimeTaskType = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskType: 'development.plan',
      taskTitle: 'step3 制定技术开发计划',
      taskDescription: '基于需求规格设计实现方案，拆解开发子任务，评估技术风险',
    });

    expect(runtimeTaskType).toBe('development.plan');
  });

  it('infers development.review for step5 review contract without explicit taskType', () => {
    const runtimeTaskType = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      planGoal: '### step5: 实现评估\n- 输出契约: 评估结论（通过/需修改 + 具体意见）',
      step: 4,
      taskTitle: 'step5 实现评估（锚定 req-1）',
      taskDescription: '输出评估结论（通过/需修改 + 具体意见）',
    });

    expect(runtimeTaskType).toBe('development.review');
  });
});
