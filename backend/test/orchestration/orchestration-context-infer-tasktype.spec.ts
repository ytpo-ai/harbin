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

  it('returns development.review for development domain with review keywords', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskTitle: 'Review implementation and validate acceptance',
      taskDescription: 'perform code review and verify behavior',
      step: 3,
    });
    expect(result).toBe('development.review');
  });

  it('returns development.plan for development domain plan-like task at step 1', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'development',
      taskTitle: 'Design architecture plan',
      taskDescription: '拆解方案与里程碑',
      step: 1,
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

  it('returns research for general domain with research keywords', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'general',
      taskTitle: 'Research competitor solutions',
      taskDescription: 'collect findings with sources',
      step: 2,
    });
    expect(result).toBe('research');
  });

  it('returns development.exec for general domain with code keywords', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'general',
      taskTitle: 'Implement API endpoint',
      taskDescription: 'code and test the handler',
      step: 2,
    });
    expect(result).toBe('development.exec');
  });

  it('returns general for general domain without keywords', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'general',
      taskTitle: 'Coordinate next update',
      taskDescription: 'prepare concise status update for stakeholders',
      step: 2,
    });
    expect(result).toBe('general');
  });

  it('preserves valid existingRuntimeTaskType', () => {
    const service = createService();
    const result = service.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: 'general',
      taskTitle: 'any task',
      taskDescription: 'any description',
      step: 2,
      existingRuntimeTaskType: 'development.review',
    });
    expect(result).toBe('development.review');
  });
});
