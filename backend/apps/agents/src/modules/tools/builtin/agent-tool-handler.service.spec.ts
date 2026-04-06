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
      {} as any,
    );

    await expect(handler.createAgentByMcp({ roleId: 'role-1', modelId: 'model-1' })).rejects.toThrow(
      'agent_master_create_agent requires name',
    );
  });
});
