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

    return new PlannerService(
      {} as any,
      planModel as any,
      agentClientService as any,
      { resolve: jest.fn() } as any,
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
        taskType: 'research',
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
    expect(result.task?.taskType).toBe('research');
  });

  it('embeds failed task agent tools in planner prompt', () => {
    const service = createService();
    const prompt = (service as any).buildIncrementalPlannerPrompt({
      ...baseContext,
      failedTasks: [
        {
          title: 'Collect references',
          agentId: 'agent-general-1',
          agentTools: ['repo-read', 'docs-read'],
          error: 'Tool mismatch',
        },
      ],
    });

    expect(prompt).toContain('(agent=agent-general-1, tools=[repo-read, docs-read])');
    expect(prompt).toContain('"action":"new|redesign"');
    expect(prompt).toContain('action="redesign"');
  });
});
