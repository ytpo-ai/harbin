import { AgentMcpProfileService } from './agent-mcp-profile.service';

describe('AgentMcpProfileService permissions alignment', () => {
  it('maps legacy capabilities to permissions in profile view', () => {
    const service = Object.create(AgentMcpProfileService.prototype);
    const profile = service['toAgentMcpMapProfile']({
      role: 'role-a',
      tools: ['tool-1'],
      capabilities: ['perm.legacy'],
      exposed: true,
      description: 'desc',
    });

    expect(profile.permissions).toEqual(['perm.legacy']);
    expect(profile.capabilities).toEqual(['perm.legacy']);
  });

  it('keeps existing manual permissions when only tools are updated', async () => {
    const existingProfile = {
      roleCode: 'role-a',
      role: 'role-a',
      tools: ['tool-old'],
      permissionsManual: ['perm.manual'],
      permissionsDerived: [],
      permissions: ['perm.manual'],
      exposed: true,
      description: 'existing',
      toObject() {
        return this;
      },
    };

    const findOneExec = jest.fn().mockResolvedValue(existingProfile);
    const findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: findOneExec }),
    });
    const findOneAndUpdateExec = jest.fn().mockResolvedValue(existingProfile);
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec: findOneAndUpdateExec });

    const service = Object.create(AgentMcpProfileService.prototype) as AgentMcpProfileService;
    (service as any).agentProfileModel = {
      findOne,
      findOneAndUpdate,
    };
    (service as any).toolService = {
      getToolsByIds: jest.fn().mockResolvedValue([]),
    };

    await service.upsertToolPermissionSet('role-a', { tools: ['tool-new'] }, [{
      id: 'role-id-a',
      code: 'role-a',
      name: 'Role A',
      status: 'active',
    }]);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { roleCode: 'role-a' },
      expect.objectContaining({
        permissionsManual: ['perm.manual'],
      }),
      { new: true, upsert: true },
    );
  });
});
