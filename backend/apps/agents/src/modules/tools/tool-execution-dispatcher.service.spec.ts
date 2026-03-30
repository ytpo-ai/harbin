import { ToolExecutionDispatcherService } from './tool-execution-dispatcher.service';

describe('ToolExecutionDispatcherService', () => {
  const createService = () => {
    const orchestrationToolHandler = { createOrchestrationPlan: jest.fn(), planInitialize: jest.fn() };
    const requirementToolHandler = { listRequirements: jest.fn(), mutateRequirement: jest.fn() };
    const repoToolHandler = { executeRepoRead: jest.fn() };
    const modelToolHandler = { listSystemModels: jest.fn() };
    const skillToolHandler = { listSkillsByTitle: jest.fn(), createSkillByMcp: jest.fn() };
    const auditToolHandler = { listHumanOperationLogs: jest.fn() };
    const meetingToolHandler = { listMeetings: jest.fn() };
    const promptRegistryToolHandler = { listPromptTemplates: jest.fn() };
    const webToolsService = { performWebSearchExa: jest.fn() };
    const agentMasterToolHandler = { getAgentsMcpList: jest.fn() };
    const agentRoleToolHandler = { listAgentRolesByMcp: jest.fn() };
    const memoToolHandler = { searchMemoMemory: jest.fn() };
    const communicationToolHandler = { sendSlackMessage: jest.fn() };
    const rdIntelligenceToolHandler = { runEngineeringStatistics: jest.fn() };

    const service = new ToolExecutionDispatcherService(
      orchestrationToolHandler as any,
      requirementToolHandler as any,
      repoToolHandler as any,
      modelToolHandler as any,
      skillToolHandler as any,
      auditToolHandler as any,
      meetingToolHandler as any,
      promptRegistryToolHandler as any,
      webToolsService as any,
      agentMasterToolHandler as any,
      agentRoleToolHandler as any,
      memoToolHandler as any,
      communicationToolHandler as any,
      rdIntelligenceToolHandler as any,
    );

    return {
      service,
      agentMasterToolHandler,
      requirementToolHandler,
      orchestrationToolHandler,
    };
  };

  it('dispatches agent list tool to agent master handler', async () => {
    const { service, agentMasterToolHandler } = createService();
    agentMasterToolHandler.getAgentsMcpList.mockResolvedValue({ total: 1, agents: [] });

    const result = await service.executeToolImplementation(
      { id: 'builtin.sys-mg.internal.agent-master.list-agents' } as any,
      { limit: 10 },
      'agent-1',
    );

    expect(agentMasterToolHandler.getAgentsMcpList).toHaveBeenCalledWith({ limit: 10 });
    expect(result).toEqual({ total: 1, agents: [] });
  });

  it('does not dispatch removed requirement board tool', async () => {
    const { service, requirementToolHandler } = createService();

    await expect(
      service.executeToolImplementation({ id: 'builtin.sys-mg.mcp.requirement.board' } as any, {}, 'agent-1'),
    ).rejects.toThrow('Tool implementation not found: builtin.sys-mg.mcp.requirement.board');

    expect(requirementToolHandler.listRequirements).not.toHaveBeenCalled();
  });

  it('dispatches requirement update tool', async () => {
    const { service, requirementToolHandler } = createService();
    requirementToolHandler.mutateRequirement.mockResolvedValue({ action: 'requirement_comment' });

    const result = await service.executeToolImplementation(
      { id: 'builtin.sys-mg.mcp.requirement.update' } as any,
      { action: 'comment', requirementId: 'req-1', content: 'ok' },
      'agent-1',
    );

    expect(requirementToolHandler.mutateRequirement).toHaveBeenCalledWith(
      { action: 'comment', requirementId: 'req-1', content: 'ok' },
      'agent-1',
      undefined,
    );
    expect(result).toEqual({ action: 'requirement_comment' });
  });

  it('does not dispatch removed requirement assign tool', async () => {
    const { service } = createService();

    await expect(
      service.executeToolImplementation({ id: 'builtin.sys-mg.mcp.requirement.assign' } as any, {}, 'agent-1'),
    ).rejects.toThrow('Tool implementation not found: builtin.sys-mg.mcp.requirement.assign');
  });

  it('does not dispatch removed requirement comment tool', async () => {
    const { service } = createService();

    await expect(
      service.executeToolImplementation({ id: 'builtin.sys-mg.mcp.requirement.comment' } as any, {}, 'agent-1'),
    ).rejects.toThrow('Tool implementation not found: builtin.sys-mg.mcp.requirement.comment');
  });

  it('dispatches orchestration plan initialize tool', async () => {
    const { service, orchestrationToolHandler } = createService();
    orchestrationToolHandler.planInitialize.mockResolvedValue({ action: 'plan_initialize', mode: 'outline' });

    const result = await service.executeToolImplementation(
      { id: 'builtin.sys-mg.mcp.orchestration.plan-initialize' } as any,
      { planId: 'p1', mode: 'outline', data: [] },
      'agent-1',
    );

    expect(orchestrationToolHandler.planInitialize).toHaveBeenCalledWith(
      { planId: 'p1', mode: 'outline', data: [] },
      undefined,
    );
    expect(result).toEqual({ action: 'plan_initialize', mode: 'outline' });
  });
});
