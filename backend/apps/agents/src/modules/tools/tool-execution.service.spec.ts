import { ToolExecutionService } from './tool-execution.service';

describe('ToolExecutionService', () => {
  function createLeanModel<T>(doc: T) {
    return {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(doc),
          }),
        }),
      }),
    };
  }

  it('throws when target tool is not found', async () => {
    const service = new ToolExecutionService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { getGovernancePolicy: jest.fn(), getIdempotencyKey: jest.fn() } as any,
      {} as any,
      { getTool: jest.fn().mockResolvedValue(null) } as any,
    );

    await expect(service.executeTool('missing.tool', 'agent-1', {})).rejects.toThrow('Tool not found: missing.tool');
  });

  it('allows authFree tool execution without explicit assignment', async () => {
    const originalStrict = process.env.TOOLS_AUTH_STRICT_PERMISSIONS;
    process.env.TOOLS_AUTH_STRICT_PERMISSIONS = 'true';

    const agentModel = createLeanModel({
      id: 'agent-1',
      roleId: 'role-1',
      tier: 'operations',
      tools: [],
      permissions: [],
      isActive: true,
    });

    const service = new ToolExecutionService(
      {} as any,
      {} as any,
      agentModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      (service as any).authorizeToolExecution(
        {
          id: 'builtin.sys-mg.mcp.inner-message.create',
          canonicalId: 'builtin.sys-mg.mcp.inner-message.create',
          enabled: true,
          authFree: true,
          requiredPermissions: [],
        },
        'agent-1',
      ),
    ).resolves.toBeUndefined();

    process.env.TOOLS_AUTH_STRICT_PERMISSIONS = originalStrict;
  });

  it('rejects non-authFree tool when assignment is enforced and tool is missing', async () => {
    const originalStrict = process.env.TOOLS_AUTH_STRICT_PERMISSIONS;
    process.env.TOOLS_AUTH_STRICT_PERMISSIONS = 'true';

    const agentModel = createLeanModel({
      id: 'agent-1',
      roleId: 'role-1',
      tier: 'operations',
      tools: [],
      permissions: [],
      isActive: true,
    });

    const service = new ToolExecutionService(
      {} as any,
      {} as any,
      agentModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      (service as any).authorizeToolExecution(
        {
          id: 'builtin.sys-mg.mcp.meeting.get',
          canonicalId: 'builtin.sys-mg.mcp.meeting.get',
          enabled: true,
          authFree: false,
          requiredPermissions: [],
        },
        'agent-1',
      ),
    ).rejects.toThrow('Tool not assigned: builtin.sys-mg.mcp.meeting.get');

    process.env.TOOLS_AUTH_STRICT_PERMISSIONS = originalStrict;
  });
});
