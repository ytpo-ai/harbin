import { Injectable } from '@nestjs/common';
import { Tool } from '../../schemas/tool.schema';
import { ToolExecutionContext } from './tool-execution-context.type';
import { OrchestrationToolHandler, RequirementToolHandler, RepoToolHandler, ModelToolHandler, SkillToolHandler, AuditToolHandler, MeetingToolHandler, PromptRegistryToolHandler, WebToolsService, AgentMasterToolHandler, AgentRoleToolHandler, MemoToolHandler, CommunicationToolHandler, RdIntelligenceToolHandler } from './builtin';
import { AGENT_CREATE_TOOL_ID, AGENT_LIST_TOOL_ID, AGENT_ROLE_CREATE_TOOL_ID, AGENT_ROLE_DELETE_TOOL_ID, AGENT_ROLE_LIST_TOOL_ID, AGENT_ROLE_UPDATE_TOOL_ID, GET_TOOL_SCHEMA_TOOL_ID, LEGACY_AGENT_LIST_TOOL_ID, PROMPT_REGISTRY_GET_TEMPLATE_TOOL_ID, PROMPT_REGISTRY_LIST_TEMPLATES_TOOL_ID, PROMPT_REGISTRY_SAVE_TEMPLATE_TOOL_ID, RD_DOCS_WRITE_TOOL_ID, RD_REPO_WRITER_TOOL_ID } from './builtin-tool-definitions';
import { IMPLEMENTED_TOOL_IDS } from './builtin-tool-catalog';
import { ToolRegistryService } from './tool-registry.service';

@Injectable()
export class ToolExecutionDispatcherService {
  constructor(
    private readonly orchestrationToolHandler: OrchestrationToolHandler,
    private readonly requirementToolHandler: RequirementToolHandler,
    private readonly repoToolHandler: RepoToolHandler,
    private readonly modelToolHandler: ModelToolHandler,
    private readonly skillToolHandler: SkillToolHandler,
    private readonly auditToolHandler: AuditToolHandler,
    private readonly meetingToolHandler: MeetingToolHandler,
    private readonly promptRegistryToolHandler: PromptRegistryToolHandler,
    private readonly webToolsService: WebToolsService,
    private readonly agentMasterToolHandler: AgentMasterToolHandler,
    private readonly agentRoleToolHandler: AgentRoleToolHandler,
    private readonly memoToolHandler: MemoToolHandler,
    private readonly communicationToolHandler: CommunicationToolHandler,
    private readonly rdIntelligenceToolHandler: RdIntelligenceToolHandler,
    private readonly toolRegistryService: ToolRegistryService,
  ) {}

  async executeToolImplementation(
    tool: Tool,
    parameters: any,
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const repoDispatch = this.dispatchRepoToolImplementation(tool.id, parameters);
    if (repoDispatch) {
      return repoDispatch;
    }

    const orchestrationDispatch = this.dispatchOrchestrationToolImplementation(tool.id, parameters, agentId, executionContext);
    if (orchestrationDispatch) {
      return orchestrationDispatch;
    }

    const requirementDispatch = this.dispatchRequirementToolImplementation(tool.id, parameters, agentId, executionContext);
    if (requirementDispatch) {
      return requirementDispatch;
    }

    const promptRegistryDispatch = this.dispatchPromptRegistryToolImplementation(tool.id, parameters);
    if (promptRegistryDispatch) {
      return promptRegistryDispatch;
    }

    switch (tool.id) {
      case 'builtin.web-retrieval.internal.web-search.exa':
        return this.webToolsService.performWebSearchExa(parameters);
      case 'composio.web-retrieval.mcp.web-search.serp':
        return this.webToolsService.performWebSearchSerp(parameters, agentId);
      case 'builtin.web-retrieval.internal.web-fetch.fetch':
        return this.webToolsService.performWebFetch(parameters);
      case 'builtin.data-analysis.internal.content-analysis.extract':
        return this.webToolsService.performContentExtract(parameters);
      case 'composio.communication.mcp.slack.send-message':
        return this.communicationToolHandler.sendSlackMessage(parameters, agentId);
      case 'composio.communication.mcp.gmail.send-email':
        return this.communicationToolHandler.sendGmail(parameters, agentId);
      case 'builtin.sys-mg.mcp.inner-message.send-internal-message':
        return this.communicationToolHandler.sendInternalMessage(parameters, agentId);
      case AGENT_LIST_TOOL_ID:
      case LEGACY_AGENT_LIST_TOOL_ID:
        return this.agentMasterToolHandler.getAgentsMcpList(parameters);
      case AGENT_CREATE_TOOL_ID:
        return this.agentMasterToolHandler.createAgentByMcp(parameters);
      case AGENT_ROLE_LIST_TOOL_ID:
        return this.agentRoleToolHandler.listAgentRolesByMcp(parameters);
      case AGENT_ROLE_CREATE_TOOL_ID:
        return this.agentRoleToolHandler.createAgentRoleByMcp(parameters);
      case AGENT_ROLE_UPDATE_TOOL_ID:
        return this.agentRoleToolHandler.updateAgentRoleByMcp(parameters);
      case AGENT_ROLE_DELETE_TOOL_ID:
        return this.agentRoleToolHandler.deleteAgentRoleByMcp(parameters);
      case 'builtin.sys-mg.mcp.rd-intelligence.engineering-statistics-run':
        return this.rdIntelligenceToolHandler.runEngineeringStatistics(parameters);
      case 'builtin.sys-mg.mcp.rd-intelligence.docs-heat-run':
        return this.rdIntelligenceToolHandler.runDocsHeat(parameters);
      case 'builtin.sys-mg.mcp.model-admin.list-models':
        return this.modelToolHandler.listSystemModels(parameters);
      case 'builtin.sys-mg.mcp.model-admin.add-model':
        return this.modelToolHandler.addModelToSystem(parameters);
      case 'builtin.sys-mg.mcp.audit.list-human-operation-log':
        return this.auditToolHandler.listHumanOperationLogs(parameters, agentId);
      case 'builtin.sys-mg.internal.memory.search-memo':
        return this.memoToolHandler.searchMemoMemory(parameters, agentId);
      case 'builtin.sys-mg.internal.memory.append-memo':
        return this.memoToolHandler.appendMemoMemory(parameters, agentId, executionContext);
      case GET_TOOL_SCHEMA_TOOL_ID:
        return this.getToolSchema(parameters, executionContext);
      case 'builtin.sys-mg.mcp.skill-master.list-skills':
        return this.skillToolHandler.listSkillsByTitle(parameters);
      case 'builtin.sys-mg.mcp.skill-master.create-skill':
        return this.skillToolHandler.createSkillByMcp(parameters);
      case 'builtin.sys-mg.mcp.meeting.list-meetings':
        return this.meetingToolHandler.listMeetings(parameters);
      case 'builtin.sys-mg.mcp.meeting.get-detail':
        return this.meetingToolHandler.getMeetingDetail(parameters);
      case 'builtin.sys-mg.mcp.meeting.send-message':
        return this.meetingToolHandler.sendMeetingMessage(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.meeting.update-status':
        return this.meetingToolHandler.updateMeetingStatus(parameters);
      case 'builtin.sys-mg.mcp.meeting.generate-summary':
      case 'builtin.sys-mg.mcp.meeting.save-summary':
        return this.meetingToolHandler.saveMeetingSummary(parameters, agentId);
      default:
        throw new Error(`Tool implementation not found: ${tool.id}`);
    }
  }
  private dispatchRepoToolImplementation(toolId: string, parameters: any): Promise<any> | undefined {
    switch (toolId) {
      case 'builtin.sys-mg.internal.rd-related.repo-read':
        return this.repoToolHandler.executeRepoRead(parameters);
      case RD_REPO_WRITER_TOOL_ID:
        return this.repoToolHandler.executeRepoWriter(parameters);
      case 'builtin.sys-mg.internal.rd-related.docs-read':
        return this.repoToolHandler.getCodeDocsReader(parameters);
      case RD_DOCS_WRITE_TOOL_ID:
        return this.repoToolHandler.executeDocsWrite(parameters);
      case 'builtin.sys-mg.internal.rd-related.updates-read':
        return this.repoToolHandler.getCodeUpdatesReader(parameters);
      default:
        return undefined;
    }
  }
  private dispatchPromptRegistryToolImplementation(
    toolId: string,
    parameters: any,
  ): Promise<any> | undefined {
    switch (toolId) {
      case PROMPT_REGISTRY_LIST_TEMPLATES_TOOL_ID:
        return this.promptRegistryToolHandler.listPromptTemplates(parameters);
      case PROMPT_REGISTRY_GET_TEMPLATE_TOOL_ID:
        return this.promptRegistryToolHandler.getPromptTemplate(parameters);
      case PROMPT_REGISTRY_SAVE_TEMPLATE_TOOL_ID:
        return this.promptRegistryToolHandler.savePromptTemplate(parameters);
      default:
        return undefined;
    }
  }
  private dispatchOrchestrationToolImplementation(
    toolId: string,
    parameters: any,
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> | undefined {
    switch (toolId) {
      case 'builtin.sys-mg.mcp.orchestration.create-plan':
        return this.orchestrationToolHandler.createOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.update-plan':
        return this.orchestrationToolHandler.updateOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.run-plan':
        return this.orchestrationToolHandler.runOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.get-plan':
        return this.orchestrationToolHandler.getOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.list-plans':
        return this.orchestrationToolHandler.listOrchestrationPlans(agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.plan-initialize':
        return this.orchestrationToolHandler.planInitialize(parameters, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.submit-task':
        return this.orchestrationToolHandler.submitOrchestrationTask(parameters, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.report-task-run-result':
        return this.orchestrationToolHandler.reportOrchestrationTaskRunResult(parameters, executionContext);
      default:
        return undefined;
    }
  }
  private dispatchRequirementToolImplementation(
    toolId: string,
    parameters: any,
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> | undefined {
    switch (toolId) {
      case 'builtin.sys-mg.mcp.requirement.list':
        return this.requirementToolHandler.listRequirements(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.get':
        return this.requirementToolHandler.getRequirement(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.create':
        return this.requirementToolHandler.createRequirement(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.update-status':
        return this.requirementToolHandler.updateRequirementStatus(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.update':
        return this.requirementToolHandler.mutateRequirement(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.sync-github':
        return this.requirementToolHandler.syncRequirementGithub(parameters, agentId);
      default:
        return undefined;
    }
  }
  getImplementedToolIds(): string[] {
    return IMPLEMENTED_TOOL_IDS;
  }

  private async getToolSchema(parameters: any, executionContext?: ToolExecutionContext): Promise<any> {
    const queriedToolId = String(parameters?.toolId || '').trim();
    if (!queriedToolId) {
      throw new Error('get-tool-schema requires toolId');
    }

    const assignedToolIds = new Set(
      (executionContext?.assignedToolIds || []).map((id) => String(id || '').trim()).filter(Boolean),
    );
    if (assignedToolIds.size > 0 && !assignedToolIds.has(queriedToolId)) {
      throw new Error(`tool schema access denied: ${queriedToolId}`);
    }

    const contract = await this.toolRegistryService.getToolInputContract(queriedToolId);
    if (!contract?.schema) {
      return {
        toolId: queriedToolId,
        found: false,
        message: `工具 ${queriedToolId} 未找到或没有参数定义`,
      };
    }

    return {
      toolId: contract.toolId,
      found: true,
      schema: contract.schema,
    };
  }
}
