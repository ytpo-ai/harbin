import { ToolService } from './tool.service';

describe('ToolService orchestration debug task', () => {
  const buildService = () => {
    const service = Object.create(ToolService.prototype);
    service.assertMeetingContext = jest.fn().mockReturnValue({ meetingId: 'meeting-1' });
    service.callOrchestrationApi = jest.fn();
    return service;
  };

  it('throws when taskId is missing', async () => {
    const service = buildService();
    await expect(service['debugOrchestrationTask']({}, 'agent-1', {})).rejects.toThrow(
      'orchestration_debug_task requires taskId',
    );
  });

  it('calls debug-run endpoint and returns debug summary', async () => {
    const service = buildService();
    service.callOrchestrationApi.mockResolvedValue({
      task: {
        status: 'failed',
        runLogs: [{ message: 'log-1' }, { message: 'log-2' }],
      },
      execution: {
        status: 'failed',
        error: 'boom',
        result: 'stack',
      },
    });

    const result = await service['debugOrchestrationTask'](
      {
        taskId: 'task-1',
        title: ' Debug title ',
        description: ' Debug description ',
        resetResult: true,
      },
      'agent-1',
      {},
    );

    expect(service.callOrchestrationApi).toHaveBeenCalledWith('POST', '/tasks/task-1/debug-run', {
      title: 'Debug title',
      description: 'Debug description',
      resetResult: true,
    });
    expect(result.action).toBe('debug_task');
    expect(result.debug.status).toBe('failed');
    expect(result.debug.error).toBe('boom');
    expect(result.debug.suggestedNextAction).toContain('retry debug');
  });

  it('returns completed next action hint', async () => {
    const service = buildService();
    service.callOrchestrationApi.mockResolvedValue({
      task: { status: 'completed', runLogs: [] },
      execution: { status: 'completed', result: 'ok' },
    });

    const result = await service['debugOrchestrationTask']({ taskId: 'task-2' }, 'agent-2', {});
    expect(result.debug.status).toBe('completed');
    expect(result.debug.suggestedNextAction).toContain('downstream');
  });
});

describe('ToolService skill master mcp', () => {
  it('maps title fuzzy query to skills search', async () => {
    const service = Object.create(ToolService.prototype);
    service.skillService = {
      getSkillsPaged: jest.fn().mockResolvedValue({
        total: 1,
        page: 1,
        pageSize: 5,
        totalPages: 1,
        items: [
          {
            id: 'skill-1',
            name: 'TypeScript Expert',
            description: 'TypeScript engineering skill',
            category: 'engineering',
            status: 'active',
            tags: ['typescript'],
            provider: 'system',
            version: '1.0.0',
            confidenceScore: 80,
            updatedAt: '2026-03-10T00:00:00.000Z',
          },
        ],
      }),
    };

    const result = await service['listSkillsByTitle']({ title: 'script', limit: 5, page: 1 });

    expect(service.skillService.getSkillsPaged).toHaveBeenCalledWith({
      status: undefined,
      category: undefined,
      search: 'script',
      page: 1,
      pageSize: 5,
    });
    expect(result.items[0].title).toBe('TypeScript Expert');
  });

  it('creates skill with title field', async () => {
    const service = Object.create(ToolService.prototype);
    service.skillService = {
      createSkill: jest.fn().mockResolvedValue({
        id: 'skill-2',
        name: 'Prompt Design',
        description: 'Prompt design and optimization',
        category: 'ai',
        status: 'active',
        tags: ['prompt'],
        provider: 'system',
        version: '1.0.0',
        confidenceScore: 70,
        createdAt: '2026-03-10T00:00:00.000Z',
      }),
    };

    const result = await service['createSkillByMcp']({
      title: 'Prompt Design',
      description: 'Prompt design and optimization',
      tags: ['prompt', '  '],
    });

    expect(service.skillService.createSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Prompt Design',
        description: 'Prompt design and optimization',
        tags: ['prompt'],
        discoveredBy: 'SkillMasterMCP',
      }),
    );
    expect(result.created).toBe(true);
    expect(result.skill.title).toBe('Prompt Design');
  });

  it('throws when create skill missing description', async () => {
    const service = Object.create(ToolService.prototype);
    service.skillService = { createSkill: jest.fn() };

    await expect(service['createSkillByMcp']({ title: 'No Desc' })).rejects.toThrow(
      'skill_master_create_skill requires description',
    );
  });
});
