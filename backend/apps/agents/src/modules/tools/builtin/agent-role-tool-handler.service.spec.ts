import { AgentRoleToolHandler } from './agent-role-tool-handler.service';

describe('AgentRoleToolHandler', () => {
  it('rejects invalid status in list roles', async () => {
    const handler = new AgentRoleToolHandler({ callAgentsApi: jest.fn() } as any);

    await expect(handler.listAgentRolesByMcp({ status: 'unknown' })).rejects.toThrow(
      'agent_role_master_list_roles invalid status, expected active|inactive',
    );
  });
});
