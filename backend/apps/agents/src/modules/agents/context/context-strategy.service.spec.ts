import { ContextStrategyService } from './context-strategy.service';

describe('ContextStrategyService', () => {
  const service = new ContextStrategyService();

  it('does not force activate skills only by development.plan task type', () => {
    const activated = service.shouldActivateSkillContent(
      {
        id: 'skill-1',
        name: 'orchestration-runtime-tasktype-selection',
        description: 'runtime task type selection',
        tags: ['pre-execute', 'runtimeTaskType'],
        proficiencyLevel: 'advanced',
      },
      {
        id: 'task-1',
        title: 'Prepare release checklist',
        description: 'collect release notes and risks',
        type: 'development.plan',
        priority: 'high',
      } as any,
      {
        task: {
          id: 'task-1',
          title: 'Prepare release checklist',
          description: 'collect release notes and risks',
          type: 'development.plan',
          priority: 'high',
        } as any,
        previousMessages: [],
        workingMemory: new Map(),
      } as any,
    );

    expect(activated).toBe(false);
  });

  it('keeps planning tag activation for legacy planning type', () => {
    const activated = service.shouldActivateSkillContent(
      {
        id: 'skill-2',
        name: 'orchestration-planner-guard',
        description: 'planner guard',
        tags: ['orchestration', 'planner'],
        proficiencyLevel: 'advanced',
      },
      {
        id: 'task-2',
        title: 'planner decision',
        description: 'pre execute decision',
        type: 'planning',
        priority: 'high',
      } as any,
      {
        task: {
          id: 'task-2',
          title: 'planner decision',
          description: 'pre execute decision',
          type: 'planning',
          priority: 'high',
        } as any,
        previousMessages: [],
        workingMemory: new Map(),
      } as any,
    );

    expect(activated).toBe(true);
  });

  it('activates skill when must rules match activation context', () => {
    const activated = service.shouldActivateSkillContent(
      {
        id: 'skill-3',
        name: 'rd-workflow',
        description: 'rd workflow',
        tags: ['domainType:development:must', 'phase:initialize:enable'],
        proficiencyLevel: 'advanced',
      },
      {
        id: 'task-3',
        title: 'init plan',
        description: 'run initialize',
        type: 'planning',
        priority: 'high',
      } as any,
      {
        task: {
          id: 'task-3',
          title: 'init plan',
          description: 'run initialize',
          type: 'planning',
          priority: 'high',
        } as any,
        previousMessages: [],
        workingMemory: new Map(),
        collaborationContext: {
          domainType: 'development',
          phase: 'initialize',
          roleInPlan: 'planner_initialize',
        },
      } as any,
    );

    expect(activated).toBe(true);
  });

  it('deactivates skill when must rules do not match activation context', () => {
    const activated = service.shouldActivateSkillContent(
      {
        id: 'skill-4',
        name: 'tasktype-selection',
        description: 'runtime task type',
        tags: ['phase:pre_execute:must', 'roleInPlan:planner,planner_pre_execution:must'],
        proficiencyLevel: 'advanced',
      },
      {
        id: 'task-4',
        title: 'post execute',
        description: 'post execution review',
        type: 'planning',
        priority: 'high',
      } as any,
      {
        task: {
          id: 'task-4',
          title: 'post execute',
          description: 'post execution review',
          type: 'planning',
          priority: 'high',
        } as any,
        previousMessages: [],
        workingMemory: new Map(),
        collaborationContext: {
          domainType: 'development',
          phase: 'post_execute',
          roleInPlan: 'planner_post_execution',
        },
      } as any,
    );

    expect(activated).toBe(false);
  });
});
