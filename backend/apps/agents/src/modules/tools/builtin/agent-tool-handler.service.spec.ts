import { AgentMasterToolHandler } from './agent-tool-handler.service';

describe('AgentMasterToolHandler', () => {
  it('requires name on createAgentByMcp', async () => {
    const handler = new AgentMasterToolHandler(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(handler.createAgentByMcp({ roleId: 'role-1', modelId: 'model-1' })).rejects.toThrow(
      'agent_master_create_agent requires name',
    );
  });

  it('pushes project scope filtering down to agent query', async () => {
    const agentModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };
    const handler = new AgentMasterToolHandler(
      { find: jest.fn() } as any,
      agentModel as any,
      {
        find: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
          exec: jest.fn().mockResolvedValue([]),
        }),
      } as any,
      {} as any,
      { find: jest.fn() } as any,
      { isReady: jest.fn().mockReturnValue(false) } as any,
      {} as any,
      {} as any,
      {
        getFirstMemoContentMapByKind: jest.fn().mockResolvedValue(new Map()),
      } as any,
    );

    await handler.getAgentsMcpList(
      { limit: 10 },
      { collaborationContext: { projectId: 'proj-1' } } as any,
    );

    expect(agentModel.find).toHaveBeenCalledWith({
      $or: [
        { projectId: 'proj-1' },
        { projectId: { $in: [null, ''] } },
        { projectId: { $exists: false } },
      ],
    });
  });
});
