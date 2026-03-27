import { OrchestrationContextService } from '../../src/modules/orchestration/services/orchestration-context.service';

describe('OrchestrationContextService inferRuntimeTaskTypeFromPlanContext', () => {
  function createService() {
    return new OrchestrationContextService({} as any, {} as any, {} as any);
  }

  it('returns research when domainType is research', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'research',
      taskTitle: 'Implement feature',
      taskDescription: 'write code and tests',
      step: 2,
    });
    expect(result).toBe('research');
  });

  it('returns development.review when taskType is provided', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskType: 'development.review',
      taskTitle: 'Review implementation and validate acceptance',
      taskDescription: 'perform code review and verify behavior',
    });
    expect(result).toBe('development.review');
  });

  it('returns development.plan when taskType is provided', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskType: 'development.plan',
      taskTitle: 'Design architecture plan',
      taskDescription: '拆解方案与里程碑',
    });
    expect(result).toBe('development.plan');
  });

  it('returns development.exec for development domain without special keywords', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskTitle: 'Refine logging module',
      taskDescription: 'adjust implementation details',
      step: 4,
    });
    expect(result).toBe('development.exec');
  });

  it('returns general for general domain when taskType is absent', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'general',
      taskTitle: 'Research competitor solutions',
      taskDescription: 'collect findings with sources',
    });
    expect(result).toBe('general');
  });

  it('uses taskType for general domain when provided', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'general',
      taskType: 'development.exec',
      taskTitle: 'Implement API endpoint',
      taskDescription: 'code and test the handler',
    });
    expect(result).toBe('development.exec');
  });

  it('returns general for general domain without keywords', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'general',
      taskTitle: 'Coordinate next update',
      taskDescription: 'prepare concise status update for stakeholders',
    });
    expect(result).toBe('general');
  });

  it('preserves valid existingRuntimeTaskType', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'general',
      taskTitle: 'any task',
      taskDescription: 'any description',
      existingRuntimeTaskType: 'development.review',
    });
    expect(result).toBe('development.review');
  });
});
