import { AgentService } from './agent.service';
import { BadRequestException, Logger } from '@nestjs/common';

describe('AgentService agent lookup query', () => {
  it('uses id lookup for non-ObjectId identifiers', () => {
    const service = Object.create(AgentService.prototype);
    const query = service['buildAgentLookupQuery']('executive-lead');

    expect(query).toEqual({ id: 'executive-lead' });
  });

  it('supports both _id and id for ObjectId-like identifiers', () => {
    const service = Object.create(AgentService.prototype);
    const query = service['buildAgentLookupQuery']('507f1f77bcf86cd799439011');

    expect(query).toEqual({
      $or: [
        { _id: '507f1f77bcf86cd799439011' },
        { id: '507f1f77bcf86cd799439011' },
      ],
    });
  });
});

describe('AgentService tier resolution', () => {
  it('throws for mismatched tier by default', () => {
    const service = Object.create(AgentService.prototype) as AgentService;

    expect(() =>
      service['resolveAgentTierOrThrow']('operations', 'executive-lead', 'leadership'),
    ).toThrow(BadRequestException);
  });

  it('coerces mismatched tier when coercion is enabled', () => {
    const service = Object.create(AgentService.prototype) as AgentService;
    (service as any).logger = new Logger('AgentServiceTest');
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    const tier = service['resolveAgentTierOrThrow']('operations', 'executive-lead', 'leadership', true);

    expect(tier).toBe('leadership');
    expect((service as any).logger.warn).toHaveBeenCalled();
  });

  it('allows explicit tier when role-tier constraint is disabled', () => {
    const service = Object.create(AgentService.prototype) as AgentService;

    const tier = service['resolveAgentTierOrThrow'](
      'operations',
      'temporary-worker',
      'temporary',
      false,
      false,
    );

    expect(tier).toBe('operations');
  });
});

describe('AgentService prompt template ref normalization', () => {
  it('normalizes valid promptTemplateRef', () => {
    const service = Object.create(AgentService.prototype) as AgentService;
    const normalized = service['normalizePromptTemplateRef']({
      scene: ' technical ',
      role: ' engineering:frontend-developer ',
    });

    expect(normalized).toEqual({
      scene: 'technical',
      role: 'engineering:frontend-developer',
    });
  });

  it('returns undefined when promptTemplateRef is null', () => {
    const service = Object.create(AgentService.prototype) as AgentService;
    expect(service['normalizePromptTemplateRef'](null)).toBeUndefined();
  });

  it('throws when promptTemplateRef is missing scene or role', () => {
    const service = Object.create(AgentService.prototype) as AgentService;
    expect(() => service['normalizePromptTemplateRef']({ scene: 'technical', role: '' })).toThrow(BadRequestException);
  });
});

describe('AgentService updateAgent tier behavior', () => {
  const buildService = () => {
    const agentModel = {
      findByIdAndUpdate: jest.fn(),
    } as any;

    const memoEventBus = {
      emit: jest.fn(),
    } as any;

    const agentRoleService = {
      assertRoleExists: jest.fn(),
      getRoleById: jest.fn(),
      ensureToolsWithinRolePermissionWhitelist: jest.fn(),
      inheritRoleProfilePermissions: jest.fn(),
    } as any;

    const service = new AgentService(
      agentModel,
      {} as any,
      {} as any,
      {} as any,
      memoEventBus,
      {} as any,
      agentRoleService,
      {} as any,
    );

    return { service, agentModel, memoEventBus, agentRoleService };
  };

  it('updates tier to explicit value when role is unchanged', async () => {
    const { service, agentModel, agentRoleService } = buildService();
    const existingAgent = {
      _id: 'mongo-id',
      id: 'agent-1',
      roleId: 'role-1',
      tier: 'temporary',
    } as any;

    jest.spyOn(service, 'getAgent').mockResolvedValue(existingAgent);
    agentRoleService.getRoleById.mockResolvedValue({
      id: 'role-1',
      code: 'temporary-worker',
      tier: 'temporary',
      status: 'active',
    });
    agentModel.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...existingAgent, tier: 'operations' }),
    });

    await service.updateAgent('agent-1', { tier: 'operations' } as any);

    expect(agentModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'mongo-id',
      expect.objectContaining({ tier: 'operations' }),
      { new: true },
    );
    expect(agentRoleService.assertRoleExists).not.toHaveBeenCalled();
  });

  it('keeps tier untouched when editing non-tier fields', async () => {
    const { service, agentModel, agentRoleService } = buildService();
    const existingAgent = {
      _id: 'mongo-id',
      id: 'agent-2',
      roleId: 'role-1',
      tier: 'temporary',
    } as any;

    jest.spyOn(service, 'getAgent').mockResolvedValue(existingAgent);
    agentRoleService.getRoleById.mockResolvedValue({
      id: 'role-1',
      code: 'temporary-worker',
      tier: 'temporary',
      status: 'active',
    });
    agentModel.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ ...existingAgent, name: 'new name' }),
    });

    await service.updateAgent('agent-2', { name: 'new name' } as any);

    expect(agentModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'mongo-id',
      expect.not.objectContaining({ tier: expect.any(String) }),
      { new: true },
    );
  });
});
