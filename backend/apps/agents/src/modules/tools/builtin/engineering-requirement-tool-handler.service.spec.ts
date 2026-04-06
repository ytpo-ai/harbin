import { RequirementToolHandler } from './engineering-requirement-tool-handler.service';

describe('RequirementToolHandler', () => {
  it('returns board payload when view=board', async () => {
    const internalApiClient = {
      callEiApi: jest.fn().mockResolvedValue({ total: 2, columns: { todo: [{ requirementId: 'req-1' }] } }),
    };
    const handler = new RequirementToolHandler(internalApiClient as any);

    const result = await handler.listRequirements({ view: 'board' }, 'agent-1');

    expect(internalApiClient.callEiApi).toHaveBeenCalledWith('GET', '/requirements/board');
    expect(result.action).toBe('requirement_list');
    expect(result.view).toBe('board');
    expect(result.total).toBe(2);
    expect(result.board).toEqual({ total: 2, columns: { todo: [{ requirementId: 'req-1' }] } });
  });

  it('returns list payload by default', async () => {
    const internalApiClient = {
      callEiApi: jest.fn().mockResolvedValue([{ requirementId: 'req-1' }]),
    };
    const handler = new RequirementToolHandler(internalApiClient as any);

    const result = await handler.listRequirements({ status: 'todo', limit: 20 }, 'agent-1');

    expect(internalApiClient.callEiApi).toHaveBeenCalledWith('GET', '/requirements?status=todo&limit=20');
    expect(result.action).toBe('requirement_list');
    expect(result.view).toBe('list');
    expect(result.total).toBe(1);
    expect(result.requirements).toEqual([{ requirementId: 'req-1' }]);
  });

  it('mutate assign routes to requirement assign API', async () => {
    const internalApiClient = {
      callEiApi: jest.fn().mockResolvedValue({ requirementId: 'req-1' }),
    };
    const handler = new RequirementToolHandler(internalApiClient as any);

    const result = await handler.mutateRequirement(
      { action: 'assign', requirementId: 'req-1', toAgentId: 'agent-2' },
      'agent-1',
      { actor: { employeeId: 'emp-1' } } as any,
    );

    expect(internalApiClient.callEiApi).toHaveBeenCalledWith('POST', '/requirements/req-1/assign', {
      toAgentId: 'agent-2',
      toAgentName: undefined,
      assignedById: 'emp-1',
      assignedByName: undefined,
      reason: undefined,
    });
    expect(result.action).toBe('requirement_assign');
    expect(result.requirementId).toBe('req-1');
  });

  it('mutate comment routes to requirement comment API', async () => {
    const internalApiClient = {
      callEiApi: jest.fn().mockResolvedValue({ requirementId: 'req-1' }),
    };
    const handler = new RequirementToolHandler(internalApiClient as any);

    const result = await handler.mutateRequirement(
      { action: 'comment', requirementId: 'req-1', content: 'done' },
      'agent-1',
      { actor: { employeeId: 'emp-1' } } as any,
    );

    expect(internalApiClient.callEiApi).toHaveBeenCalledWith('POST', '/requirements/req-1/comments', {
      content: 'done',
      authorId: 'emp-1',
      authorName: undefined,
      authorType: 'agent',
    });
    expect(result.action).toBe('requirement_comment');
    expect(result.requirementId).toBe('req-1');
  });
});
