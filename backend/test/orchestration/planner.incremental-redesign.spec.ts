import { PlannerService, IncrementalPlannerContext } from '../../src/modules/orchestration/planner.service';

describe('PlannerService incremental redesign', () => {
  const baseContext: IncrementalPlannerContext = {
    planGoal: 'Implement orchestration guardrails',
    completedTasks: [],
    failedTasks: [],
    totalSteps: 1,
  };

  function createService(overrides?: { executeTask?: jest.Mock }) {
    const planModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          strategy: { plannerAgentId: 'planner-1' },
        }),
      }),
    };
    const agentClientService = {
      executeTask: overrides?.executeTask || jest.fn(),
    };
    const contextService = {
      buildGeneratingPrompt: jest.fn().mockResolvedValue('generated-prompt'),
    };

    return new PlannerService(
      {} as any,
      planModel as any,
      agentClientService as any,
      contextService as any,
    );
  }

  it('parses redesign action payload from planner response', async () => {
    const executeTask = jest.fn().mockResolvedValue(JSON.stringify({
      action: 'redesign',
      redesignTaskId: 'task-failed-1',
      task: {
        title: 'Re-run with research-capable agent',
        description: 'Reassign to agent with web tools',
        priority: 'high',
        agentId: 'agent-research-1',
        requiredTools: ['web-search', 'web-fetch'],
      },
      isGoalReached: false,
      reasoning: 'Previous agent missed required tools',
      costTokens: 128,
    }));

    const service = createService({ executeTask });
    const result = await service.generateNextTask('plan-1', baseContext);

    expect(result.action).toBe('redesign');
    expect(result.redesignTaskId).toBe('task-failed-1');
    expect(result.task?.agentId).toBe('agent-research-1');
    expect(result.task?.requiredTools).toEqual(['web-search', 'web-fetch']);
  });

  it('returns fallback result when planner response is not json', async () => {
    const executeTask = jest.fn().mockResolvedValue('not-json');
    const service = createService({ executeTask });
    const result = await service.generateNextTask('plan-1', baseContext);
    expect(result.isGoalReached).toBe(false);
    expect(result.reasoning).toContain('Failed to parse planner response');
  });
});
