import { Injectable } from '@nestjs/common';
import { Tool } from '../../schemas/tool.schema';
import { ToolExecutionContext } from './tool-execution-context.type';
import { OrchestrationToolHandler, RequirementToolHandler, RepoToolHandler, ModelToolHandler, SkillToolHandler, AuditToolHandler, MeetingToolHandler, PromptRegistryToolHandler, WebToolsService, AgentMasterToolHandler, AgentRoleToolHandler, MemoToolHandler, CommunicationToolHandler, RdIntelligenceToolHandler } from './builtin';
import {
  TOOL_ID__AGENT_CREATE,
  TOOL_ID__AGENT_LIST,
  TOOL_ID__AGENT_ROLE_CREATE,
  TOOL_ID__AGENT_ROLE_DELETE,
  TOOL_ID__AGENT_ROLE_LIST,
  TOOL_ID__AGENT_ROLE_UPDATE,
  TOOL_ID__EMPLYEE_LOGS,
  TOOL_ID__CONTENT_EXTRACT,
  TOOL_ID__ENGINEERING_COMMIT_READ,
  TOOL_ID__ENGINEERING_STATISTICS_DOCS_HEAT_RUN,
  TOOL_ID__ENGINEERING_DOCS_READ,
  TOOL_ID__ENGINEERING_REPO_READ,
  TOOL_ID__ENGINEERING_STATISTICS_FILES_RUN,
  TOOL_ID__GMAIL_SEND_EMAIL,
  TOOL_ID__GET_TOOL_SCHEMA,
  TOOL_ID__MEETING_GET_DETAIL,
  TOOL_ID__MEETING_LIST,
  TOOL_ID__MEETING_SAVE_SUMMARY,
  TOOL_ID__MEETING_SEND_MESSAGE,
  TOOL_ID__MEETING_UPDATE_STATUS,
  TOOL_ID__AGENT_MEMORY_APPEND_MEMO,
  TOOL_ID__AGENT_MEMORY_SEARCH_MEMO,
  TOOL_ID__AGENT_MODEL_ADD,
  TOOL_ID__AGENT_MODEL_LIST,
  TOOL_ID__ORCHESTRATION_CREATE_PLAN,
  TOOL_ID__ORCHESTRATION_GET_PLAN,
  TOOL_ID__ORCHESTRATION_LIST_PLANS,
  TOOL_ID__ORCHESTRATION_INIT_PLAN,
  TOOL_ID__ORCHESTRATION_RUN_PLAN,
  TOOL_ID__ORCHESTRATION_SUBMIT_TASK,
  TOOL_ID__ORCHESTRATION_SUBMIT_TASK_RUN_RESULT,
  TOOL_ID__ORCHESTRATION_UPDATE_PLAN,
  TOOL_ID__PROMPT_REGISTRY_GET_TEMPLATE,
  TOOL_ID__PROMPT_REGISTRY_LIST_TEMPLATES,
  TOOL_ID__PROMPT_REGISTRY_SAVE_TEMPLATE,
  TOOL_ID__ENGINEERING_DOCS_WRITE,
  TOOL_ID__ENGINEERING_REPO_WRITER,
  TOOL_ID__REQUIREMENT_CREATE,
  TOOL_ID__REQUIREMENT_GET,
  TOOL_ID__REQUIREMENT_LIST,
  TOOL_ID__REQUIREMENT_SYNC_GITHUB,
  TOOL_ID__REQUIREMENT_UPDATE,
  TOOL_ID__REQUIREMENT_UPDATE_STATUS,
  TOOL_ID__SEND_INTERNAL_MESSAGE,
  TOOL_ID__AGENT_SKILL_CREATE,
  TOOL_ID__AGENT_SKILL_LIST,
  TOOL_ID__SLACK_SEND_MESSAGE,
  TOOL_ID__WEB_FETCH,
  TOOL_ID__WEB_SEARCH_EXA,
  TOOL_ID__WEB_SEARCH_SERP,
} from './builtin-tool-definitions';
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
      case TOOL_ID__WEB_SEARCH_EXA:
        return this.webToolsService.performWebSearchExa(parameters);
      case TOOL_ID__WEB_SEARCH_SERP:
        return this.webToolsService.performWebSearchSerp(parameters, agentId);
      case TOOL_ID__WEB_FETCH:
        return this.webToolsService.performWebFetch(parameters);
      case TOOL_ID__CONTENT_EXTRACT:
        return this.webToolsService.performContentExtract(parameters);
      case TOOL_ID__SLACK_SEND_MESSAGE:
        return this.communicationToolHandler.sendSlackMessage(parameters, agentId);
      case TOOL_ID__GMAIL_SEND_EMAIL:
        return this.communicationToolHandler.sendGmail(parameters, agentId);
      case TOOL_ID__SEND_INTERNAL_MESSAGE:
        return this.communicationToolHandler.sendInternalMessage(parameters, agentId);
      case TOOL_ID__AGENT_LIST:
        return this.agentMasterToolHandler.getAgentsMcpList(parameters);
      case TOOL_ID__AGENT_CREATE:
        return this.agentMasterToolHandler.createAgentByMcp(parameters);
      case TOOL_ID__AGENT_ROLE_LIST:
        return this.agentRoleToolHandler.listAgentRolesByMcp(parameters);
      case TOOL_ID__AGENT_ROLE_CREATE:
        return this.agentRoleToolHandler.createAgentRoleByMcp(parameters);
      case TOOL_ID__AGENT_ROLE_UPDATE:
        return this.agentRoleToolHandler.updateAgentRoleByMcp(parameters);
      case TOOL_ID__AGENT_ROLE_DELETE:
        return this.agentRoleToolHandler.deleteAgentRoleByMcp(parameters);
      case TOOL_ID__ENGINEERING_STATISTICS_FILES_RUN:
        return this.rdIntelligenceToolHandler.runEngineeringStatistics(parameters);
      case TOOL_ID__ENGINEERING_STATISTICS_DOCS_HEAT_RUN:
        return this.rdIntelligenceToolHandler.runDocsHeat(parameters);
      case TOOL_ID__AGENT_MODEL_LIST:
        return this.modelToolHandler.listSystemModels(parameters);
      case TOOL_ID__AGENT_MODEL_ADD:
        return this.modelToolHandler.addModelToSystem(parameters);
      case TOOL_ID__EMPLYEE_LOGS:
        return this.auditToolHandler.listHumanOperationLogs(parameters, agentId);
      case TOOL_ID__AGENT_MEMORY_SEARCH_MEMO:
        return this.memoToolHandler.searchMemoMemory(parameters, agentId);
      case TOOL_ID__AGENT_MEMORY_APPEND_MEMO:
        return this.memoToolHandler.appendMemoMemory(parameters, agentId, executionContext);
      case TOOL_ID__GET_TOOL_SCHEMA:
        return this.getToolSchema(parameters, executionContext);
      case TOOL_ID__AGENT_SKILL_LIST:
        return this.skillToolHandler.listSkillsByTitle(parameters);
      case TOOL_ID__AGENT_SKILL_CREATE:
        return this.skillToolHandler.createSkillByMcp(parameters);
      case TOOL_ID__MEETING_LIST:
        return this.meetingToolHandler.listMeetings(parameters);
      case TOOL_ID__MEETING_GET_DETAIL:
        return this.meetingToolHandler.getMeetingDetail(parameters);
      case TOOL_ID__MEETING_SEND_MESSAGE:
        return this.meetingToolHandler.sendMeetingMessage(parameters, agentId, executionContext);
      case TOOL_ID__MEETING_UPDATE_STATUS:
        return this.meetingToolHandler.updateMeetingStatus(parameters);
      case TOOL_ID__MEETING_SAVE_SUMMARY:
        return this.meetingToolHandler.saveMeetingSummary(parameters, agentId);
      default:
        throw new Error(`Tool implementation not found: ${tool.id}`);
    }
  }
  private dispatchRepoToolImplementation(toolId: string, parameters: any): Promise<any> | undefined {
    switch (toolId) {
      case TOOL_ID__ENGINEERING_REPO_READ:
        return this.repoToolHandler.executeRepoRead(parameters);
      case TOOL_ID__ENGINEERING_REPO_WRITER:
        return this.repoToolHandler.executeRepoWriter(parameters);
      case TOOL_ID__ENGINEERING_DOCS_READ:
        return this.repoToolHandler.getCodeDocsReader(parameters);
      case TOOL_ID__ENGINEERING_DOCS_WRITE:
        return this.repoToolHandler.executeDocsWrite(parameters);
      case TOOL_ID__ENGINEERING_COMMIT_READ:
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
      case TOOL_ID__PROMPT_REGISTRY_LIST_TEMPLATES:
        return this.promptRegistryToolHandler.listPromptTemplates(parameters);
      case TOOL_ID__PROMPT_REGISTRY_GET_TEMPLATE:
        return this.promptRegistryToolHandler.getPromptTemplate(parameters);
      case TOOL_ID__PROMPT_REGISTRY_SAVE_TEMPLATE:
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
      case TOOL_ID__ORCHESTRATION_CREATE_PLAN:
        return this.orchestrationToolHandler.createOrchestrationPlan(parameters, agentId, executionContext);
      case TOOL_ID__ORCHESTRATION_UPDATE_PLAN:
        return this.orchestrationToolHandler.updateOrchestrationPlan(parameters, agentId, executionContext);
      case TOOL_ID__ORCHESTRATION_RUN_PLAN:
        return this.orchestrationToolHandler.runOrchestrationPlan(parameters, agentId, executionContext);
      case TOOL_ID__ORCHESTRATION_GET_PLAN:
        return this.orchestrationToolHandler.getOrchestrationPlan(parameters, agentId, executionContext);
      case TOOL_ID__ORCHESTRATION_LIST_PLANS:
        return this.orchestrationToolHandler.listOrchestrationPlans(agentId, executionContext);
      case TOOL_ID__ORCHESTRATION_INIT_PLAN:
        return this.orchestrationToolHandler.planInitialize(parameters, executionContext);
      case TOOL_ID__ORCHESTRATION_SUBMIT_TASK:
        return this.orchestrationToolHandler.submitOrchestrationTask(parameters, executionContext);
      case TOOL_ID__ORCHESTRATION_SUBMIT_TASK_RUN_RESULT:
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
      case TOOL_ID__REQUIREMENT_LIST:
        return this.requirementToolHandler.listRequirements(parameters, agentId, executionContext);
      case TOOL_ID__REQUIREMENT_GET:
        return this.requirementToolHandler.getRequirement(parameters, agentId, executionContext);
      case TOOL_ID__REQUIREMENT_CREATE:
        return this.requirementToolHandler.createRequirement(parameters, agentId, executionContext);
      case TOOL_ID__REQUIREMENT_UPDATE_STATUS:
        return this.requirementToolHandler.updateRequirementStatus(parameters, agentId, executionContext);
      case TOOL_ID__REQUIREMENT_UPDATE:
        return this.requirementToolHandler.mutateRequirement(parameters, agentId, executionContext);
      case TOOL_ID__REQUIREMENT_SYNC_GITHUB:
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
      hint: this.buildToolSchemaHint(contract.toolId, contract.schema),
    };
  }

  private buildToolSchemaHint(toolId: string, schema: Record<string, unknown>): string | null {
    const properties = (schema as any)?.properties;
    if (!properties || typeof properties !== 'object') {
      return null;
    }

    const required = new Set(
      Array.isArray((schema as any).required)
        ? (schema as any).required.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [],
    );

    const rows = Object.entries(properties as Record<string, any>);
    if (!rows.length) {
      return null;
    }

    const lines = [`工具参数契约 ${toolId}:`];
    if (required.size > 0) {
      lines.push(`required: [${Array.from(required).join(', ')}]`);
    }
    if ((schema as any).additionalProperties === false) {
      lines.push('additionalProperties: false');
    }
    lines.push('properties:');
    for (const [key, spec] of rows) {
      const type = String(spec?.type || 'any');
      const enumText = Array.isArray(spec?.enum) ? `, enum=${JSON.stringify(spec.enum)}` : '';
      const requiredText = required.has(key) ? ' (required)' : '';
      const description = String(spec?.description || '').trim();
      const descText = description ? ` - ${description}` : '';
      lines.push(`  ${key}: ${type}${enumText}${requiredText}${descText}`);
    }

    return lines.join('\n');
  }
}
