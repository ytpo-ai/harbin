import { ToolExecutionDispatcherService } from './tool-execution-dispatcher.service';

describe('ToolExecutionDispatcherService', () => {
  const createService = () => {
    const orchestrationToolHandler = { createOrchestrationPlan: jest.fn() };
    const requirementToolHandler = { listRequirements: jest.fn() };
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
});
