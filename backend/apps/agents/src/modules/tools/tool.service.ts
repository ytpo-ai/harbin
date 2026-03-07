import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { access, readFile } from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GatewayUserContext } from '@libs/contracts';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { Tool, ToolDocument } from '../../../../../src/shared/schemas/tool.schema';
import { ToolExecution, ToolExecutionDocument } from '../../../../../src/shared/schemas/toolExecution.schema';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '../../../../../src/shared/schemas/agent-profile.schema';
import { Employee, EmployeeDocument, EmployeeType } from '../../../../../src/shared/schemas/employee.schema';
import { OperationLog, OperationLogDocument } from '../../../../../src/shared/schemas/operation-log.schema';
import { ComposioService } from './composio.service';
import { ModelManagementService } from '../models/model-management.service';
import { buildCodeDocsMcpSummary, CodeDocsMcpFeatureCandidate } from './gh-repo-docs-reader-mcp.util';
import { buildCodeUpdatesMcpSummary, CodeUpdatesMcpCommit } from './gh-repo-updates-mcp.util';
import { codeDocsReader } from './local-repo-docs-reader.util';
import { codeUpdatesReader } from './local-repo-updates-reader.util';
import { MemoService } from '../memos/memo.service';

const DEFAULT_PROFILE = {
  role: 'general-assistant',
  tools: [],
  capabilities: [],
  exposed: false,
};

const execFileAsync = promisify(execFile);

interface ToolExecutionContext {
  teamContext?: Record<string, any>;
  taskType?: string;
  teamId?: string;
  taskId?: string;
}

@Injectable()
export class ToolService {
  private readonly logger = new Logger(ToolService.name);
  private readonly orchestrationBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001/api';
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';

  constructor(
    @InjectModel(Tool.name) private toolModel: Model<ToolDocument>,
    @InjectModel(ToolExecution.name) private executionModel: Model<ToolExecutionDocument>,
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(OperationLog.name) private operationLogModel: Model<OperationLogDocument>,
    private composioService: ComposioService,
    private modelManagementService: ModelManagementService,
    private memoService: MemoService,
  ) {
    void this.initializeBuiltinTools();
  }

  private async initializeBuiltinTools() {
    const builtinTools = [
      {
        id: 'websearch',
        name: 'Web Search',
        description: 'Search web information via Composio SERPAPI',
        type: 'web_search' as const,
        category: 'Information Retrieval',
        requiredPermissions: [{ id: 'basic_web', name: 'Basic Web Access', level: 'basic' }],
        tokenCost: 10,
        implementation: {
          type: 'built_in' as const,
          parameters: { query: 'string', maxResults: 'number' },
        },
      },
      {
        id: 'webfetch',
        name: 'Web Fetch',
        description: 'Fetch webpage content by URL and return clean text',
        type: 'web_search' as const,
        category: 'Information Retrieval',
        requiredPermissions: [{ id: 'basic_web', name: 'Basic Web Access', level: 'basic' }],
        tokenCost: 8,
        implementation: {
          type: 'built_in' as const,
          parameters: { url: 'string', maxChars: 'number', timeoutMs: 'number' },
        },
      },
      {
        id: 'content_extract',
        name: 'Content Extract',
        description: 'Extract clean text, key bullets and numeric rows from raw html or text',
        type: 'data_analysis' as const,
        category: 'Information Retrieval',
        requiredPermissions: [{ id: 'basic_web', name: 'Basic Web Access', level: 'basic' }],
        tokenCost: 6,
        implementation: {
          type: 'built_in' as const,
          parameters: { content: 'string', maxBullets: 'number', maxNumericRows: 'number' },
        },
      },
      {
        id: 'slack',
        name: 'Slack',
        description: 'Send Slack messages via Composio',
        type: 'api_call' as const,
        category: 'Communication',
        requiredPermissions: [{ id: 'slack_send', name: 'Slack Message Permission', level: 'intermediate' }],
        tokenCost: 15,
        implementation: {
          type: 'built_in' as const,
          parameters: { channel: 'string', text: 'string' },
        },
      },
      {
        id: 'gmail',
        name: 'Gmail',
        description: 'Send or draft email via Composio',
        type: 'api_call' as const,
        category: 'Communication',
        requiredPermissions: [{ id: 'gmail_send', name: 'Gmail Permission', level: 'intermediate' }],
        tokenCost: 20,
        implementation: {
          type: 'built_in' as const,
          parameters: { to: 'string', subject: 'string', body: 'string', action: 'string' },
        },
      },
      {
        id: 'repo-read',
        name: 'Repo Read',
        description: 'Execute read-only bash commands to read local repository files (git log, cat, ls, grep)',
        type: 'data_analysis' as const,
        category: 'Engineering Intelligence',
        requiredPermissions: [{ id: 'repo_read', name: 'Repository Read', level: 'basic' }],
        tokenCost: 2,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            command: 'string',
          },
        },
      },
      {
        id: 'gh-repo-docs-reader-mcp',
        name: 'Code Docs MCP',
        description: 'Summarize implemented core features from repository docs with evidence paths',
        type: 'data_analysis' as const,
        category: 'Engineering Intelligence',
        requiredPermissions: [{ id: 'repo_docs_read', name: 'Repository Docs Read', level: 'basic' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            query: 'string',
            focus: 'string',
            maxFeatures: 'number',
            maxEvidencePerFeature: 'number',
          },
        },
      },
      {
        id: 'gh-repo-updates-mcp',
        name: 'Code Updates MCP',
        description: 'Summarize recent repository updates from git commits with evidence',
        type: 'data_analysis' as const,
        category: 'Engineering Intelligence',
        requiredPermissions: [{ id: 'repo_git_read', name: 'Repository Git Read', level: 'basic' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            hours: 'number',
            limit: 'number',
            includeFiles: 'boolean',
            minSeverity: 'string',
          },
        },
      },
      {
        id: 'local-repo-docs-reader',
        name: 'Code Docs Reader',
        description: 'Read raw documentation files from docs/ directory',
        type: 'data_analysis' as const,
        category: 'Engineering Intelligence',
        requiredPermissions: [{ id: 'repo_docs_read', name: 'Repository Docs Read', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            focus: 'string',
            maxFiles: 'number',
          },
        },
      },
      {
        id: 'local-repo-updates-reader',
        name: 'Code Updates Reader',
        description: 'Read raw git commit history from repository',
        type: 'data_analysis' as const,
        category: 'Engineering Intelligence',
        requiredPermissions: [{ id: 'repo_git_read', name: 'Repository Git Read', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            hours: 'number',
            limit: 'number',
          },
        },
      },
      {
        id: 'agents_mcp_list',
        name: 'Agents MCP List',
        description: 'List current agents, roles, and capability summaries from MCP visibility rules',
        type: 'data_analysis' as const,
        category: 'System Intelligence',
        requiredPermissions: [{ id: 'data_access', name: 'Agent Registry Read', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: { includeHidden: 'boolean', limit: 'number' },
        },
      },
      {
        id: 'model_mcp_list_models',
        name: 'Model MCP List Models',
        description: 'List models currently available in system registry',
        type: 'data_analysis' as const,
        category: 'Model Management',
        requiredPermissions: [{ id: 'model_registry_read', name: 'Model Registry Read', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            provider: 'string',
            limit: 'number',
          },
        },
      },
      {
        id: 'model_mcp_search_latest',
        name: 'Model MCP Search Latest',
        description: 'Search latest model releases from internet and return normalized candidates',
        type: 'web_search' as const,
        category: 'Model Management',
        requiredPermissions: [{ id: 'model_registry_read', name: 'Model Registry Read', level: 'basic' }],
        tokenCost: 8,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            providers: 'string[]',
            query: 'string',
            maxResultsPerQuery: 'number',
            limit: 'number',
          },
        },
      },
      {
        id: 'model_mcp_add_model',
        name: 'Model MCP Add Model',
        description: 'Add a model into system model registry with deduplication',
        type: 'data_analysis' as const,
        category: 'Model Management',
        requiredPermissions: [{ id: 'model_registry_write', name: 'Model Registry Write', level: 'admin' }],
        tokenCost: 5,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            provider: 'string',
            model: 'string',
            name: 'string',
            id: 'string',
            maxTokens: 'number',
            temperature: 'number',
            topP: 'number',
          },
        },
      },
      {
        id: 'memo_mcp_search',
        name: 'Memo MCP Search',
        description: 'Search agent memo memory with progressive loading summaries',
        type: 'data_analysis' as const,
        category: 'Memory',
        requiredPermissions: [{ id: 'memo_read', name: 'Agent Memo Read', level: 'basic' }],
        tokenCost: 2,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            query: 'string',
            category: 'string',
            memoType: 'string',
            limit: 'number',
            detail: 'boolean',
          },
        },
      },
      {
        id: 'memo_mcp_append',
        name: 'Memo MCP Append',
        description: 'Append or create memo entries for long-term memory',
        type: 'data_analysis' as const,
        category: 'Memory',
        requiredPermissions: [{ id: 'memo_write', name: 'Agent Memo Write', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            title: 'string',
            content: 'string',
            category: 'string',
            memoType: 'string',
            memoId: 'string',
            taskId: 'string',
            tags: 'string[]',
          },
        },
      },
      {
        id: 'human_operation_log_mcp_list',
        name: 'Human Operation Log MCP List',
        description: 'List operation logs for the human bound to the requesting exclusive assistant',
        type: 'data_analysis' as const,
        category: 'Audit',
        requiredPermissions: [{ id: 'human_operation_log_read', name: 'Human Operation Log Read', level: 'basic' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            from: 'string',
            to: 'string',
            action: 'string',
            resourceKeyword: 'string',
            success: 'boolean',
            statusCode: 'number',
            page: 'number',
            pageSize: 'number',
          },
        },
      },
      {
        id: 'orchestration_create_plan',
        name: 'Orchestration Create Plan',
        description: 'Create orchestration plan from prompt in meeting workflow',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 6,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            prompt: 'string',
            title: 'string',
            mode: 'string',
            plannerAgentId: 'string',
            autoRun: 'boolean',
          },
        },
      },
      {
        id: 'orchestration_run_plan',
        name: 'Orchestration Run Plan',
        description: 'Run an orchestration plan in meeting workflow',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            planId: 'string',
            continueOnFailure: 'boolean',
            confirm: 'boolean',
          },
        },
      },
      {
        id: 'orchestration_get_plan',
        name: 'Orchestration Get Plan',
        description: 'Get orchestration plan details',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_read', name: 'Orchestration Read', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            planId: 'string',
          },
        },
      },
      {
        id: 'orchestration_list_plans',
        name: 'Orchestration List Plans',
        description: 'List orchestration plans',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_read', name: 'Orchestration Read', level: 'basic' }],
        tokenCost: 2,
        implementation: {
          type: 'built_in' as const,
          parameters: {},
        },
      },
      {
        id: 'orchestration_reassign_task',
        name: 'Orchestration Reassign Task',
        description: 'Reassign orchestration task executor',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            taskId: 'string',
            executorType: 'string',
            executorId: 'string',
            reason: 'string',
            confirm: 'boolean',
          },
        },
      },
      {
        id: 'orchestration_complete_human_task',
        name: 'Orchestration Complete Human Task',
        description: 'Mark waiting human task as completed',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            taskId: 'string',
            summary: 'string',
            output: 'string',
            confirm: 'boolean',
          },
        },
      },
    ];

    const virtualToolIds = [
      'web_search',
      'code_execution',
      'file_read',
      'file_write',
      'data_analysis',
      'video_editing',
      'api_call',
    ];

    await this.toolModel.deleteMany({ id: { $in: virtualToolIds } }).exec();

    for (const toolData of builtinTools) {
      const existingTool = await this.toolModel.findOne({ id: toolData.id }).exec();
      if (!existingTool) {
        const tool = new this.toolModel(toolData);
        await tool.save();
        this.logger.log(`已注册内置工具: ${toolData.name}`);
      }
    }

    const implementedToolIds = new Set(this.getImplementedToolIds());
    const missingImplementations = builtinTools
      .map((tool) => tool.id)
      .filter((toolId) => !implementedToolIds.has(toolId));
    if (missingImplementations.length) {
      this.logger.error(`Builtin tools missing implementation: ${missingImplementations.join(', ')}`);
    }

    const persistedBuiltIns = await this.toolModel
      .find({ 'implementation.type': 'built_in' })
      .select({ id: 1, _id: 0 })
      .lean()
      .exec();
    const unresolvedPersisted = persistedBuiltIns
      .map((tool) => String((tool as any).id || '').trim())
      .filter(Boolean)
      .filter((toolId) => !implementedToolIds.has(toolId));
    if (unresolvedPersisted.length) {
      this.logger.warn(`Persisted built-in tools without implementation: ${unresolvedPersisted.join(', ')}`);
    }
  }

  async getAllTools(): Promise<Tool[]> {
    return this.toolModel.find().sort({ category: 1, name: 1 }).exec();
  }

  async getTool(toolId: string): Promise<Tool | null> {
    return this.toolModel.findOne({ id: toolId }).exec();
  }

  async getToolsByIds(toolIds: string[]): Promise<Tool[]> {
    if (!toolIds.length) return [];
    return this.toolModel.find({ id: { $in: toolIds }, enabled: true }).exec();
  }

  async createTool(toolData: Omit<Tool, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tool> {
    const newTool = new this.toolModel({
      ...toolData,
      id: uuidv4(),
    });
    return newTool.save();
  }

  async updateTool(toolId: string, updates: Partial<Tool>): Promise<Tool | null> {
    return this.toolModel
      .findOneAndUpdate({ id: toolId }, { ...updates, updatedAt: new Date() }, { new: true })
      .exec();
  }

  async deleteTool(toolId: string): Promise<boolean> {
    const result = await this.toolModel.findOneAndDelete({ id: toolId }).exec();
    return !!result;
  }

  async executeTool(
    toolId: string,
    agentId: string,
    parameters: any,
    taskId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<ToolExecution> {
    const tool = await this.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }
    if (!tool.enabled) {
      throw new Error(`Tool is disabled: ${toolId}`);
    }

    const execution = new this.executionModel({
      id: uuidv4(),
      toolId,
      agentId,
      taskId,
      parameters,
      status: 'executing',
      tokenCost: tool.tokenCost || 0,
    });
    await execution.save();

    try {
      const result = await this.executeToolImplementation(tool, parameters, agentId, {
        ...(executionContext || {}),
        taskId: taskId || executionContext?.taskId,
      });
      execution.result = result;
      execution.status = 'completed';
      execution.executionTime = Date.now() - execution.timestamp.getTime();
      await execution.save();
      return execution;
    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      execution.executionTime = Date.now() - execution.timestamp.getTime();
      await execution.save();
      throw error;
    }
  }

  private async executeToolImplementation(
    tool: Tool,
    parameters: any,
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    switch (tool.id) {
      case 'websearch':
        return this.performWebSearch(parameters, agentId);
      case 'webfetch':
        return this.performWebFetch(parameters);
      case 'content_extract':
        return this.performContentExtract(parameters);
      case 'slack':
        return this.sendSlackMessage(parameters, agentId);
      case 'gmail':
        return this.sendGmail(parameters, agentId);
      case 'repo-read':
        return this.executeRepoRead(parameters);
      case 'agents_mcp_list':
        return this.getAgentsMcpList(parameters);
      case 'gh-repo-docs-reader-mcp':
        return this.getCodeDocsMcp(parameters);
      case 'gh-repo-updates-mcp':
        return this.getCodeUpdatesMcp(parameters);
      case 'local-repo-docs-reader':
        return this.getCodeDocsReader(parameters);
      case 'local-repo-updates-reader':
        return this.getCodeUpdatesReader(parameters);
      case 'model_mcp_list_models':
        return this.listSystemModels(parameters);
      case 'model_mcp_search_latest':
        return this.searchLatestModels(parameters, agentId);
      case 'model_mcp_add_model':
        return this.addModelToSystem(parameters);
      case 'human_operation_log_mcp_list':
        return this.listHumanOperationLogs(parameters, agentId);
      case 'memo_mcp_search':
        return this.searchMemoMemory(parameters, agentId);
      case 'memo_mcp_append':
        return this.appendMemoMemory(parameters, agentId);
      case 'orchestration_create_plan':
        return this.createOrchestrationPlan(parameters, agentId, executionContext);
      case 'orchestration_run_plan':
        return this.runOrchestrationPlan(parameters, agentId, executionContext);
      case 'orchestration_get_plan':
        return this.getOrchestrationPlan(parameters, agentId, executionContext);
      case 'orchestration_list_plans':
        return this.listOrchestrationPlans(parameters, agentId, executionContext);
      case 'orchestration_reassign_task':
        return this.reassignOrchestrationTask(parameters, agentId, executionContext);
      case 'orchestration_complete_human_task':
        return this.completeOrchestrationHumanTask(parameters, agentId, executionContext);
      default:
        throw new Error(`Tool implementation not found: ${tool.id}`);
    }
  }

  private getImplementedToolIds(): string[] {
    return [
      'websearch',
      'webfetch',
      'content_extract',
      'slack',
      'gmail',
      'repo-read',
      'agents_mcp_list',
      'gh-repo-docs-reader-mcp',
      'gh-repo-updates-mcp',
      'local-repo-docs-reader',
      'local-repo-updates-reader',
      'model_mcp_list_models',
      'model_mcp_search_latest',
      'model_mcp_add_model',
      'human_operation_log_mcp_list',
      'memo_mcp_search',
      'memo_mcp_append',
      'orchestration_create_plan',
      'orchestration_run_plan',
      'orchestration_get_plan',
      'orchestration_list_plans',
      'orchestration_reassign_task',
      'orchestration_complete_human_task',
    ];
  }

  private async searchMemoMemory(
    params: { query?: string; memoType?: 'knowledge' | 'standard'; limit?: number; detail?: boolean },
    agentId?: string,
  ): Promise<any> {
    if (!agentId) {
      throw new Error('memo_mcp_search requires agentId');
    }

    const query = params?.query?.trim() || '';
    const memories = await this.memoService.searchMemos(agentId, query, {
      memoType: params?.memoType,
      limit: params?.limit,
      progressive: true,
      detail: params?.detail === true,
    });

    return {
      agentId,
      query,
      total: memories.length,
      memories,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async appendMemoMemory(
    params: {
      memoId?: string;
      title?: string;
      content?: string;
      memoType?: 'knowledge' | 'standard';
      taskId?: string;
      topic?: string;
      tags?: string[];
    },
    agentId?: string,
  ): Promise<any> {
    if (!agentId) {
      throw new Error('memo_mcp_append requires agentId');
    }
    if (!params?.content?.trim()) {
      throw new Error('memo_mcp_append requires content');
    }

    if (params.memoId) {
      const existing = await this.memoService.getMemoById(params.memoId);
      const updated = await this.memoService.updateMemo(existing.id, {
        content: `${existing.content}\n\n${params.content.trim()}`,
        tags: Array.from(new Set([...(existing.tags || []), ...((params.tags || []).filter(Boolean))])),
      });
      return {
        action: 'updated',
        memo: updated,
      };
    }

    const created = await this.memoService.createMemo({
      agentId,
      title: params.title?.trim() || 'Runtime memo',
      content: params.content.trim(),
      memoType: params.memoType || 'knowledge',
      payload: {
        taskId: params.taskId,
        topic: params.topic || 'runtime',
      },
      tags: params.tags || [],
      source: 'memo_mcp_append',
    });

    return {
      action: 'created',
      memo: created,
    };
  }

  private buildSignedHeaders(organizationId?: string): Record<string, string> {
    const now = Date.now();
    const context: GatewayUserContext = {
      employeeId: 'agents-service',
      role: 'system',
      organizationId,
      issuedAt: now,
      expiresAt: now + 60 * 1000,
    };
    const encoded = encodeUserContext(context);
    const signature = signEncodedContext(encoded, this.contextSecret);
    return {
      'x-user-context': encoded,
      'x-user-signature': signature,
      'content-type': 'application/json',
    };
  }

  private resolveMeetingContext(executionContext?: ToolExecutionContext): {
    meetingId?: string;
    organizationId?: string;
    initiatorId?: string;
    taskType?: string;
  } {
    const teamContext = executionContext?.teamContext || {};
    return {
      meetingId:
        (typeof teamContext.meetingId === 'string' && teamContext.meetingId) ||
        (typeof executionContext?.teamId === 'string' && executionContext.teamId) ||
        undefined,
      organizationId:
        (typeof teamContext.organizationId === 'string' && teamContext.organizationId) ||
        undefined,
      initiatorId:
        (typeof teamContext.initiatorId === 'string' && teamContext.initiatorId) ||
        (typeof teamContext.triggeredBy === 'string' && teamContext.triggeredBy) ||
        undefined,
      taskType:
        executionContext?.taskType ||
        (typeof teamContext.meetingType === 'string' ? 'discussion' : undefined),
    };
  }

  private assertMeetingContext(executionContext?: ToolExecutionContext): {
    meetingId: string;
    organizationId?: string;
    initiatorId?: string;
  } {
    const context = this.resolveMeetingContext(executionContext);
    const meetingLike = context.taskType === 'discussion' || Boolean(context.meetingId);
    if (!meetingLike) {
      throw new Error('This orchestration MCP tool is only available in meeting context');
    }
    return {
      meetingId: context.meetingId || 'unknown-meeting',
      organizationId: context.organizationId,
      initiatorId: context.initiatorId,
    };
  }

  private async resolveOrganizationIdForAgent(
    agentId?: string,
    fallback?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<string | undefined> {
    if (fallback) {
      return fallback;
    }
    const meetingContext = this.resolveMeetingContext(executionContext);
    if (meetingContext.initiatorId) {
      const initiator = await this.employeeModel
        .findOne({ id: meetingContext.initiatorId })
        .select({ organizationId: 1 })
        .lean()
        .exec();
      const initiatorOrg = (initiator as any)?.organizationId;
      if (initiatorOrg) {
        return initiatorOrg;
      }
    }
    const participants = Array.isArray(executionContext?.teamContext?.participants)
      ? (executionContext?.teamContext?.participants as unknown[])
      : [];
    for (const candidateId of participants) {
      if (typeof candidateId !== 'string' || !candidateId.trim()) continue;
      const employee = await this.employeeModel
        .findOne({ id: candidateId.trim() })
        .select({ organizationId: 1 })
        .lean()
        .exec();
      const employeeOrg = (employee as any)?.organizationId;
      if (employeeOrg) {
        return employeeOrg;
      }
    }
    if (!agentId) {
      return undefined;
    }
    const owner = await this.employeeModel
      .findOne({ agentId })
      .select({ organizationId: 1 })
      .lean()
      .exec();
    return (owner as any)?.organizationId;
  }

  private requireConfirm(params: any, action: string): void {
    if (params?.confirm === true) {
      return;
    }
    throw new Error(`${action} requires confirm=true`);
  }

  private async callOrchestrationApi(
    method: 'GET' | 'POST',
    endpoint: string,
    body: any,
    organizationId?: string,
  ): Promise<any> {
    const url = `${this.orchestrationBaseUrl}/orchestration${endpoint}`;
    const headers = this.buildSignedHeaders(organizationId);
    const response = await axios.request({
      method,
      url,
      headers,
      data: body,
      timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
    });
    return response.data;
  }

  private async createOrchestrationPlan(
    params: {
      prompt?: string;
      title?: string;
      mode?: 'sequential' | 'parallel' | 'hybrid';
      plannerAgentId?: string;
      autoRun?: boolean;
      organizationId?: string;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
    if (!params?.prompt?.trim()) {
      throw new Error('orchestration_create_plan requires prompt');
    }
    const payload = {
      prompt: params.prompt.trim(),
      title: params.title?.trim(),
      mode: params.mode,
      plannerAgentId: params.plannerAgentId,
      autoRun: params.autoRun === true,
    };
    const organizationId = await this.resolveOrganizationIdForAgent(
      agentId,
      params.organizationId || meeting.organizationId,
      executionContext,
    );
    if (!organizationId) {
      throw new Error('Missing organization context for orchestration_create_plan');
    }
    const result = await this.callOrchestrationApi('POST', '/plans/from-prompt', payload, organizationId);
    return {
      action: 'create_plan',
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async runOrchestrationPlan(
    params: { planId?: string; continueOnFailure?: boolean; confirm?: boolean; organizationId?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
    if (!params?.planId?.trim()) {
      throw new Error('orchestration_run_plan requires planId');
    }
    this.requireConfirm(params, 'orchestration_run_plan');
    const organizationId = await this.resolveOrganizationIdForAgent(
      agentId,
      params.organizationId || meeting.organizationId,
      executionContext,
    );
    if (!organizationId) {
      throw new Error('Missing organization context for orchestration_run_plan');
    }
    const result = await this.callOrchestrationApi(
      'POST',
      `/plans/${params.planId.trim()}/run`,
      { continueOnFailure: params.continueOnFailure === true },
      organizationId,
    );
    return {
      action: 'run_plan',
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async getOrchestrationPlan(
    params: { planId?: string; organizationId?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
    if (!params?.planId?.trim()) {
      throw new Error('orchestration_get_plan requires planId');
    }
    const organizationId = await this.resolveOrganizationIdForAgent(
      agentId,
      params.organizationId || meeting.organizationId,
      executionContext,
    );
    if (!organizationId) {
      throw new Error('Missing organization context for orchestration_get_plan');
    }
    const result = await this.callOrchestrationApi('GET', `/plans/${params.planId.trim()}`, undefined, organizationId);
    return {
      action: 'get_plan',
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async listOrchestrationPlans(
    params: { organizationId?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
    const organizationId = await this.resolveOrganizationIdForAgent(
      agentId,
      params.organizationId || meeting.organizationId,
      executionContext,
    );
    if (!organizationId) {
      throw new Error('Missing organization context for orchestration_list_plans');
    }
    const result = await this.callOrchestrationApi('GET', '/plans', undefined, organizationId);
    return {
      action: 'list_plans',
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async reassignOrchestrationTask(
    params: {
      taskId?: string;
      executorType?: 'agent' | 'employee' | 'unassigned';
      executorId?: string;
      reason?: string;
      confirm?: boolean;
      organizationId?: string;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
    if (!params?.taskId?.trim()) {
      throw new Error('orchestration_reassign_task requires taskId');
    }
    if (!params?.executorType) {
      throw new Error('orchestration_reassign_task requires executorType');
    }
    this.requireConfirm(params, 'orchestration_reassign_task');
    const organizationId = await this.resolveOrganizationIdForAgent(
      agentId,
      params.organizationId || meeting.organizationId,
      executionContext,
    );
    if (!organizationId) {
      throw new Error('Missing organization context for orchestration_reassign_task');
    }
    const result = await this.callOrchestrationApi(
      'POST',
      `/tasks/${params.taskId.trim()}/reassign`,
      {
        executorType: params.executorType,
        executorId: params.executorId,
        reason: params.reason,
      },
      organizationId,
    );
    return {
      action: 'reassign_task',
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async completeOrchestrationHumanTask(
    params: { taskId?: string; summary?: string; output?: string; confirm?: boolean; organizationId?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
    if (!params?.taskId?.trim()) {
      throw new Error('orchestration_complete_human_task requires taskId');
    }
    this.requireConfirm(params, 'orchestration_complete_human_task');
    const organizationId = await this.resolveOrganizationIdForAgent(
      agentId,
      params.organizationId || meeting.organizationId,
      executionContext,
    );
    if (!organizationId) {
      throw new Error('Missing organization context for orchestration_complete_human_task');
    }
    const result = await this.callOrchestrationApi(
      'POST',
      `/tasks/${params.taskId.trim()}/complete-human`,
      {
        summary: params.summary,
        output: params.output,
      },
      organizationId,
    );
    return {
      action: 'complete_human_task',
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private normalizeProvider(provider?: string): string {
    const value = String(provider || '').trim().toLowerCase();
    if (value === 'kimi') return 'moonshot';
    if (value === 'claude') return 'anthropic';
    return value;
  }

  private inferProvider(text: string): string {
    const value = text.toLowerCase();
    if (value.includes('openai') || value.includes('gpt-') || /\bo1\b/.test(value)) return 'openai';
    if (value.includes('anthropic') || value.includes('claude-')) return 'anthropic';
    if (value.includes('google') || value.includes('gemini-')) return 'google';
    if (value.includes('moonshot') || value.includes('kimi-')) return 'moonshot';
    if (value.includes('deepseek')) return 'deepseek';
    if (value.includes('mistral')) return 'mistral';
    if (value.includes('meta') || value.includes('llama-')) return 'meta';
    if (value.includes('alibaba') || value.includes('qwen')) return 'alibaba';
    if (value.includes('xai') || value.includes('grok')) return 'xai';
    return 'custom';
  }

  private extractCandidateModels(text: string): Array<{ model: string; provider: string }> {
    const regex =
      /(gpt-[a-z0-9.\-]+|o1[a-z0-9.\-]*|claude-[a-z0-9.\-]+|gemini-[a-z0-9.\-]+|deepseek-[a-z0-9.\-]+|qwen[a-z0-9.\-]*|llama-[a-z0-9.\-]+|kimi-[a-z0-9.\-]+|moonshot-[a-z0-9.\-]+|mistral-[a-z0-9.\-]+|grok-[a-z0-9.\-]+)/gi;
    const matches = text.match(regex) || [];
    const unique = Array.from(new Set(matches.map((item) => item.toLowerCase())));
    return unique.map((model) => ({
      model,
      provider: this.inferProvider(model),
    }));
  }

  private toModelDisplayName(model: string): string {
    return model
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private async searchLatestModels(
    params: { providers?: string[]; query?: string; maxResultsPerQuery?: number; limit?: number },
    userId?: string,
  ): Promise<any> {
    const maxResultsPerQuery = Math.max(3, Math.min(Number(params?.maxResultsPerQuery || 10), 20));
    const limit = Math.max(1, Math.min(Number(params?.limit || 20), 100));
    const providers = (params?.providers || [])
      .map((provider) => this.normalizeProvider(provider))
      .filter(Boolean);
    const defaultProviders = ['openai', 'anthropic', 'google', 'moonshot', 'deepseek', 'mistral', 'meta', 'alibaba'];
    const providerTargets = providers.length ? providers : defaultProviders;

    const queries = params?.query?.trim()
      ? [params.query.trim()]
      : providerTargets.map(
          (provider) => `${provider} latest AI model release official announcement ${new Date().getFullYear()}`,
        );

    const settled = await Promise.allSettled(
      queries.map((query) => this.composioService.webSearch(query, maxResultsPerQuery, userId)),
    );

    const candidates: Array<{
      provider: string;
      model: string;
      name: string;
      sourceTitle: string;
      sourceUrl: string;
      snippet?: string;
      confidence: 'low' | 'medium' | 'high';
    }> = [];
    const failedQueries: Array<{ query: string; error: string }> = [];

    settled.forEach((item, index) => {
      const query = queries[index];
      if (item.status !== 'fulfilled' || !item.value?.successful) {
        failedQueries.push({
          query,
          error:
            item.status === 'fulfilled'
              ? item.value?.error || 'Search failed'
              : item.reason instanceof Error
                ? item.reason.message
                : 'Search failed',
        });
        return;
      }

      const raw = item.value?.data || {};
      const rows = raw?.organic || raw?.results?.organic_results || raw?.results || [];
      const organicResults = Array.isArray(rows) ? rows : [];

      for (const row of organicResults) {
        const title = String(row?.title || '').trim();
        const url = String(row?.link || row?.url || '').trim();
        const snippet = String(row?.snippet || '').trim();
        const joined = `${title} ${snippet}`.trim();
        if (!joined) continue;

        const extracted = this.extractCandidateModels(joined);
        for (const candidate of extracted) {
          const inferred = this.normalizeProvider(candidate.provider || this.inferProvider(`${joined} ${url}`));
          const confidence =
            url.includes('openai.com') ||
            url.includes('anthropic.com') ||
            url.includes('google.com') ||
            url.includes('deepseek.com') ||
            url.includes('moonshot.cn')
              ? 'high'
              : snippet.toLowerCase().includes('official')
                ? 'medium'
                : 'low';

          candidates.push({
            provider: inferred,
            model: candidate.model,
            name: this.toModelDisplayName(candidate.model),
            sourceTitle: title,
            sourceUrl: url,
            snippet,
            confidence,
          });
        }
      }
    });

    const dedupMap = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      const key = `${candidate.provider}:${candidate.model}`;
      const existing = dedupMap.get(key);
      if (!existing) {
        dedupMap.set(key, candidate);
        continue;
      }
      if (existing.confidence !== 'high' && candidate.confidence === 'high') {
        dedupMap.set(key, candidate);
      }
    }

    const normalized = Array.from(dedupMap.values()).slice(0, limit);

    return {
      searchedAt: new Date().toISOString(),
      queryCount: queries.length,
      failedQueries,
      totalCandidates: normalized.length,
      candidates: normalized,
    };
  }

  private async addModelToSystem(params: {
    provider: string;
    model: string;
    name?: string;
    id?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  }): Promise<any> {
    if (!params?.provider || !params?.model) {
      throw new Error('model_mcp_add_model requires parameters: provider, model');
    }

    const normalizedProvider = this.normalizeProvider(params.provider);
    const normalizedModel = String(params.model).trim().toLowerCase();
    const maxTokens = Number.isFinite(Number(params.maxTokens)) ? Number(params.maxTokens) : 8192;
    const temperature = Number.isFinite(Number(params.temperature)) ? Number(params.temperature) : 0.7;
    const topP = Number.isFinite(Number(params.topP)) ? Number(params.topP) : 1;

    const result = await this.modelManagementService.addModelToSystem({
      id: params.id,
      name: params.name?.trim() || this.toModelDisplayName(normalizedModel),
      provider: normalizedProvider as any,
      model: normalizedModel,
      maxTokens,
      temperature,
      topP,
    });

    return {
      created: result.created,
      duplicateBy: result.duplicateBy || null,
      message: result.message,
      model: result.model,
      timestamp: new Date().toISOString(),
    };
  }

  private async listSystemModels(params: { provider?: string; limit?: number }): Promise<any> {
    const provider = this.normalizeProvider(params?.provider);
    const limit = Math.max(1, Math.min(Number(params?.limit || 200), 500));

    const sourceModels = provider
      ? await this.modelManagementService.getModelsByProvider(provider)
      : await this.modelManagementService.getAvailableModels();

    const models = sourceModels.slice(0, limit).map((model) => ({
      id: model.id,
      name: model.name,
      provider: this.normalizeProvider(model.provider),
      model: model.model,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      topP: model.topP,
    }));

    return {
      total: sourceModels.length,
      returned: models.length,
      provider: provider || 'all',
      models,
      timestamp: new Date().toISOString(),
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseDateOrThrow(raw?: string, fieldName?: string): Date | undefined {
    if (!raw) return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid ${fieldName || 'date'} format`);
    }
    return parsed;
  }

  private async getBoundHumanByAssistant(agentId: string): Promise<{ id: string; name?: string }> {
    if (!agentId) {
      throw new Error('human_operation_log_mcp_list requires assistant agentId');
    }

    const humanEmployees = await this.employeeModel
      .find({
        type: EmployeeType.HUMAN,
        exclusiveAssistantAgentId: agentId,
      })
      .select({ id: 1, name: 1 })
      .lean()
      .exec();

    if (humanEmployees.length === 0) {
      throw new Error('Current assistant is not bound to any human employee');
    }
    if (humanEmployees.length > 1) {
      throw new Error('Current assistant is bound to multiple humans, access denied');
    }

    const [human] = humanEmployees;
    if (!human?.id) {
      throw new Error('Bound human employee data is incomplete');
    }

    return {
      id: human.id,
      name: human.name,
    };
  }

  private async listHumanOperationLogs(
    params: {
      from?: string;
      to?: string;
      action?: string;
      resourceKeyword?: string;
      success?: boolean;
      statusCode?: number;
      page?: number;
      pageSize?: number;
    },
    agentId?: string,
  ): Promise<any> {
    const boundHuman = await this.getBoundHumanByAssistant(agentId || '');
    const from = this.parseDateOrThrow(params?.from, 'from');
    const to = this.parseDateOrThrow(params?.to, 'to');

    if (from && to && from.getTime() > to.getTime()) {
      throw new Error('Invalid date range: from must be earlier than to');
    }

    const page = Math.max(1, Math.min(Number(params?.page || 1), 10000));
    const pageSize = Math.max(1, Math.min(Number(params?.pageSize || 20), 100));
    const skip = (page - 1) * pageSize;

    const filter: any = {
      humanEmployeeId: boundHuman.id,
    };

    if (params?.action?.trim()) {
      filter.action = { $regex: this.escapeRegex(params.action.trim()), $options: 'i' };
    }
    if (params?.resourceKeyword?.trim()) {
      filter.resource = { $regex: this.escapeRegex(params.resourceKeyword.trim()), $options: 'i' };
    }
    if (typeof params?.success === 'boolean') {
      filter.success = params.success;
    }

    const parsedStatusCode = Number(params?.statusCode);
    if (Number.isFinite(parsedStatusCode) && parsedStatusCode >= 100 && parsedStatusCode <= 599) {
      filter.statusCode = parsedStatusCode;
    }

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = from;
      if (to) filter.timestamp.$lte = to;
    }

    const [total, rows] = await Promise.all([
      this.operationLogModel.countDocuments(filter).exec(),
      this.operationLogModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
    ]);

    return {
      humanEmployeeId: boundHuman.id,
      humanName: boundHuman.name || '',
      assistantAgentId: agentId,
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      logs: rows.map((row) => ({
        id: row.id,
        action: row.action,
        resource: row.resource,
        httpMethod: row.httpMethod,
        statusCode: row.statusCode,
        success: row.success,
        sourceService: row.sourceService,
        durationMs: row.durationMs,
        ip: row.ip,
        userAgent: row.userAgent,
        requestId: row.requestId,
        query: row.query,
        payload: row.payload,
        responseSummary: row.responseSummary,
        timestamp: row.timestamp,
      })),
      fetchedAt: new Date().toISOString(),
    };
  }

  private async getAgentsMcpList(params: { includeHidden?: boolean; limit?: number }): Promise<any> {
    const includeHidden = params?.includeHidden === true;
    const limit = Math.max(1, Math.min(Number(params?.limit || 20), 100));
    const agents = await this.agentModel.find().exec();
    const agentTypes = Array.from(new Set(agents.map((agent: any) => String(agent.type || '').trim()).filter(Boolean)));
    const profiles = await this.agentProfileModel.find({ agentType: { $in: agentTypes } }).exec();
    const profileMap = new Map<string, AgentProfile>();
    for (const profile of profiles) {
      profileMap.set(profile.agentType, profile);
    }

    const mapped = agents.map((agent) => {
      const plain = agent?.toObject ? agent.toObject() : agent;
      const type = (plain.type || '').trim();
      const profile = profileMap.get(type) || DEFAULT_PROFILE;
      return {
        id: plain.id || plain._id?.toString?.() || plain._id,
        name: plain.name,
        type: plain.type,
        role: plain.role || profile.role,
        capabilitySet: Array.from(new Set([...(plain.capabilities || []), ...(profile.capabilities || [])])).slice(0, 12),
        exposed: profile.exposed === true,
        isActive: plain.isActive === true,
      };
    });

    const visibleAgents = mapped.filter((item) => includeHidden || item.exposed).slice(0, limit);

    return {
      total: mapped.length,
      visible: visibleAgents.length,
      includeHidden,
      agents: visibleAgents,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async getCodeDocsMcp(params: {
    query?: string;
    focus?: string;
    maxFeatures?: number;
    maxEvidencePerFeature?: number;
  }): Promise<any> {
    const maxFeatures = Math.max(1, Math.min(Number(params?.maxFeatures || 8), 20));
    const maxEvidencePerFeature = Math.max(1, Math.min(Number(params?.maxEvidencePerFeature || 3), 6));
    const workspaceRoot = await this.resolveWorkspaceRoot();
    const targetFiles = [
      'README.md',
      'FEATURES.md',
      'docs/features/FUNCTIONS.md',
      'docs/overview/README.md',
      'docs/README.md',
      'docs/guide/USER_GUIDE.md',
    ];

    const candidates: CodeDocsMcpFeatureCandidate[] = [];
    const loadedFiles: string[] = [];

    for (const relativePath of targetFiles) {
      const absolutePath = path.join(workspaceRoot, relativePath);
      const exists = await this.fileExists(absolutePath);
      if (!exists) continue;

      const content = await readFile(absolutePath, 'utf8');
      loadedFiles.push(relativePath);
      candidates.push(...buildCodeDocsMcpSummary.collectCandidatesFromMarkdown(content, relativePath));
    }

    if (!loadedFiles.length) {
      return {
        query: params?.query || '',
        focus: params?.focus || 'core_features',
        analyzedFiles: [],
        coreFeatures: [],
        unknownBoundary: ['仓库 docs 未找到可读取的目标文档，暂无法盘点核心功能。'],
        generatedAt: new Date().toISOString(),
      };
    }

    const summary = buildCodeDocsMcpSummary.summarizeFeatures(candidates, {
      query: params?.query,
      maxFeatures,
      maxEvidencePerFeature,
    });

    return {
      query: params?.query || '',
      focus: params?.focus || 'core_features',
      analyzedFiles: loadedFiles,
      coreFeatures: summary.features,
      unknownBoundary: summary.unknownBoundary,
      generatedAt: new Date().toISOString(),
    };
  }

  private async getCodeUpdatesMcp(params: {
    hours?: number;
    limit?: number;
    includeFiles?: boolean;
    minSeverity?: 'high' | 'medium' | 'low';
  }): Promise<any> {
    const hours = Math.max(1, Math.min(Number(params?.hours || 24), 168));
    const limit = Math.max(1, Math.min(Number(params?.limit || 10), 30));
    const includeFiles = params?.includeFiles !== false;
    const minSeverity = ['high', 'medium', 'low'].includes(String(params?.minSeverity || '').toLowerCase())
      ? (String(params?.minSeverity).toLowerCase() as 'high' | 'medium' | 'low')
      : 'medium';

    const workspaceRoot = await this.resolveWorkspaceRoot();
    const hasGit = await this.fileExists(path.join(workspaceRoot, '.git'));
    if (!hasGit) {
      return {
        hours,
        limit,
        commits: [],
        majorUpdates: [],
        unknownBoundary: ['当前运行目录无 .git 信息，无法统计最近更新。'],
        minSeverity,
        generatedAt: new Date().toISOString(),
      };
    }

    const sinceArg = `${hours} hours ago`;
    const logFormat = '%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e';
    const { stdout } = await execFileAsync(
      'git',
      ['log', `--since=${sinceArg}`, '--date=iso-strict', `--format=${logFormat}`, '-n', String(limit)],
      { cwd: workspaceRoot },
    );

    const commits = this.parseCodeUpdatesCommits(stdout || '');
    const commitsWithFiles: CodeUpdatesMcpCommit[] = [];

    for (const commit of commits) {
      if (includeFiles) {
        const files = await this.getCommitFiles(workspaceRoot, commit.hash);
        commitsWithFiles.push({ ...commit, files });
      } else {
        commitsWithFiles.push({ ...commit, files: [] });
      }
    }

    const summary = buildCodeUpdatesMcpSummary.summarize(commitsWithFiles, { limit, minSeverity });
    return {
      hours,
      limit,
      minSeverity,
      commits: commitsWithFiles,
      majorUpdates: summary.majorUpdates,
      unknownBoundary: summary.unknownBoundary,
      generatedAt: new Date().toISOString(),
    };
  }

  private async getCodeDocsReader(params: {
    focus?: string;
    maxFiles?: number;
  }): Promise<any> {
    const maxFiles = Math.max(1, Math.min(Number(params?.maxFiles || 20), 50));
    const workspaceRoot = await this.resolveWorkspaceRoot();
    const result = codeDocsReader.read({
      focus: params?.focus,
      maxFiles,
      workspaceRoot,
    });

    if (result.error) {
      return {
        focus: params?.focus || 'all',
        workspaceRoot,
        totalDocs: result.totalFiles,
        returnedFiles: 0,
        files: [],
        error: result.error,
        errorType: result.errorType || result.error.split(':')[0],
        matchMode: result.matchMode || 'none',
        focusMatchedCount: result.focusMatchedCount || 0,
        suggestions: result.suggestions || [],
        fallbackApplied: result.fallbackApplied || false,
        retryCount: result.retryCount || 0,
        attemptedKeywords: result.attemptedKeywords || [],
        troubleshooting: [
          'Check if AGENT_WORKSPACE_ROOT environment variable is set correctly',
          'Verify the docs/ directory exists in the workspace root',
          'Ensure the agent service has been restarted after setting environment variables',
        ],
        generatedAt: new Date().toISOString(),
      };
    }

    return {
      focus: params?.focus || 'all',
      workspaceRoot,
      totalDocs: result.totalFiles,
      returnedFiles: result.files.length,
      matchMode: result.matchMode || 'all',
      focusMatchedCount: result.focusMatchedCount ?? result.files.length,
      suggestions: result.suggestions || [],
      fallbackApplied: result.fallbackApplied || false,
      retryCount: result.retryCount || 0,
      attemptedKeywords: result.attemptedKeywords || [],
      files: result.files.map(f => ({
        path: f.path,
        lastModified: f.lastModified,
        content: f.content,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  private async getCodeUpdatesReader(params: {
    hours?: number;
    limit?: number;
  }): Promise<any> {
    const hours = Math.max(1, Math.min(Number(params?.hours || 24), 168));
    const limit = Math.max(1, Math.min(Number(params?.limit || 20), 50));
    const workspaceRoot = await this.resolveWorkspaceRoot();

    const result = codeUpdatesReader.read({ hours, limit, workspaceRoot });

    if (result.error) {
      return {
        hours,
        limit,
        workspaceRoot,
        totalCommits: result.totalCommits,
        commits: [],
        error: result.error,
        errorType: result.error.split(':')[0],
        troubleshooting: [
          'Verify AGENT_WORKSPACE_ROOT points to a valid git repository',
          'Ensure the directory contains a .git folder',
          'Check if git is installed and accessible',
        ],
        generatedAt: new Date().toISOString(),
      };
    }

    return {
      hours,
      limit,
      workspaceRoot,
      totalCommits: result.totalCommits,
      commits: result.commits,
      generatedAt: new Date().toISOString(),
    };
  }

  private async executeRepoRead(params: { command: string }): Promise<any> {
    const allowedCommands = ['git log', 'git show', 'git diff', 'cat', 'ls', 'grep', 'head', 'tail', 'find'];
    const command = (params.command || '').trim();
    const workspaceRoot = await this.resolveWorkspaceRoot();

    if (!command) {
      return { 
        error: 'MISSING_COMMAND: No command provided',
        command: '',
        workspaceRoot,
        troubleshooting: ['Provide a valid command parameter, e.g., "git log --oneline -10" or "ls docs/"'],
      };
    }

    const isAllowed = allowedCommands.some(cmd => 
      command.toLowerCase().startsWith(cmd.toLowerCase())
    );

    if (!isAllowed) {
      return { 
        error: `COMMAND_NOT_ALLOWED: "${command}" is not permitted`,
        command,
        workspaceRoot,
        allowedCommands,
        troubleshooting: [`Only read-only commands are allowed: ${allowedCommands.join(', ')}`],
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(command, {
        cwd: workspaceRoot,
        maxBuffer: 5 * 1024 * 1024,
      });

      const output = stdout || stderr;
      
      if (!output.trim()) {
        return {
          command,
          workspaceRoot,
          output: '',
          success: true,
          message: 'Command executed successfully but returned no output',
        };
      }

      return {
        command,
        workspaceRoot,
        output,
        success: true,
      };
    } catch (error: any) {
      return {
        command,
        workspaceRoot,
        output: '',
        success: false,
        error: `COMMAND_FAILED: ${error.message}`,
        errorDetails: error.stderr || error.stdout,
        troubleshooting: [
          'Check if the command syntax is correct',
          'Verify the file or directory exists',
          'Ensure you have read permissions',
          `Working directory: ${workspaceRoot}`,
        ],
      };
    }
  }

  private async resolveWorkspaceRoot(): Promise<string> {
    const envWorkspaceRoot = process.env.AGENT_WORKSPACE_ROOT;
    if (envWorkspaceRoot) {
      if (await this.fileExists(path.join(envWorkspaceRoot, 'README.md'))) {
        return envWorkspaceRoot;
      }
    }

    const candidates = [
      process.cwd(),
      path.resolve(process.cwd(), '..'),
      path.resolve(process.cwd(), '../..'),
      path.resolve(__dirname, '../../../../../../'),
    ];

    for (const candidate of candidates) {
      if ((await this.fileExists(path.join(candidate, 'README.md'))) && (await this.fileExists(path.join(candidate, 'docs')))) {
        return candidate;
      }
    }

    return process.cwd();
  }

  private async fileExists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }

  private parseCodeUpdatesCommits(raw: string): CodeUpdatesMcpCommit[] {
    const rows = raw
      .split('\x1e')
      .map((item) => item.trim())
      .filter(Boolean);

    const result: CodeUpdatesMcpCommit[] = [];
    for (const row of rows) {
      const [hash, shortHash, author, committedAt, subject] = row.split('\x1f');
      if (!hash) continue;
      result.push({
        hash: (hash || '').trim(),
        shortHash: (shortHash || '').trim(),
        author: (author || '').trim(),
        committedAt: (committedAt || '').trim(),
        subject: (subject || '').trim(),
        files: [],
      });
    }
    return result;
  }

  private async getCommitFiles(workspaceRoot: string, hash: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('git', ['show', '--name-only', '--pretty=format:', hash], {
        cwd: workspaceRoot,
      });
      return (stdout || '')
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 100);
    } catch {
      return [];
    }
  }

  private async performWebSearch(params: { query: string; maxResults?: number }, userId?: string): Promise<any> {
    if (!params?.query) {
      throw new Error('websearch requires parameter: query');
    }

    const result = await this.composioService.webSearch(params.query, params.maxResults || 10, userId);
    if (!result.successful) {
      throw new Error(result.error || 'Composio websearch failed');
    }

    const raw = result.data || {};
    const rows = raw?.organic || raw?.results?.organic_results || raw?.results || [];
    const organicResults = Array.isArray(rows) ? rows : [];

    return {
      query: params.query,
      provider: 'composio/serpapi',
      results: organicResults.map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        date: item.date,
      })),
      totalResults: organicResults.length,
      raw,
    };
  }

  private async performWebFetch(params: { url: string; maxChars?: number; timeoutMs?: number }): Promise<any> {
    const url = String(params?.url || '').trim();
    if (!url) {
      throw new Error('webfetch requires parameter: url');
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('webfetch requires http/https url');
    }

    const timeoutMs = Math.min(Math.max(Number(params?.timeoutMs || 12000), 3000), 30000);
    const maxChars = Math.min(Math.max(Number(params?.maxChars || 12000), 1000), 50000);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'user-agent': 'ai-agent-team-webfetch/1.0',
          accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`webfetch failed with status ${response.status}`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const raw = await response.text();
      const cleanText = this.extractCleanText(raw);
      const truncated = cleanText.length > maxChars;

      return {
        url,
        status: response.status,
        contentType,
        title: this.extractHtmlTitle(raw),
        content: truncated ? cleanText.slice(0, maxChars) : cleanText,
        contentLength: cleanText.length,
        truncated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'webfetch unknown error';
      throw new Error(`webfetch failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async performContentExtract(params: {
    content: string;
    maxBullets?: number;
    maxNumericRows?: number;
  }): Promise<any> {
    const rawContent = String(params?.content || '').trim();
    if (!rawContent) {
      throw new Error('content_extract requires parameter: content');
    }

    const text = this.extractCleanText(rawContent);
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const maxBullets = Math.min(Math.max(Number(params?.maxBullets || 8), 3), 20);
    const maxNumericRows = Math.min(Math.max(Number(params?.maxNumericRows || 12), 3), 30);

    const bullets = lines
      .filter((line) => line.length >= 18)
      .slice(0, maxBullets)
      .map((line) => `- ${line}`);

    const numericRows = lines
      .filter((line) => /\d/.test(line) && /[,:|\-]/.test(line) && line.length >= 8)
      .slice(0, maxNumericRows);

    return {
      text,
      bullets,
      numericRows,
      stats: {
        textLength: text.length,
        lineCount: lines.length,
        bulletCount: bullets.length,
        numericRowCount: numericRows.length,
      },
    };
  }

  private extractHtmlTitle(raw: string): string | undefined {
    const match = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match?.[1]) {
      return undefined;
    }
    return match[1].replace(/\s+/g, ' ').trim();
  }

  private extractCleanText(raw: string): string {
    return raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private async sendSlackMessage(params: { channel: string; text: string }, userId?: string): Promise<any> {
    if (!params?.channel || !params?.text) {
      throw new Error('slack requires parameters: channel, text');
    }

    const result = await this.composioService.slackSendMessage(params.channel, params.text, userId);
    if (!result.successful) {
      throw new Error(result.error || 'Composio slack send failed');
    }

    return {
      provider: 'composio/slack',
      status: 'sent',
      channel: params.channel,
      text: params.text,
      raw: result.data,
    };
  }

  private async sendGmail(
    params: { to: string; subject: string; body: string; action?: 'draft' | 'send' },
    userId?: string,
  ): Promise<any> {
    if (!params?.to || !params?.subject || !params?.body) {
      throw new Error('gmail requires parameters: to, subject, body');
    }

    const action = params.action || 'send';
    const result = await this.composioService.gmailSendEmail(
      params.to,
      params.subject,
      params.body,
      action,
      userId,
    );

    if (!result.successful) {
      throw new Error(result.error || 'Composio gmail send failed');
    }

    return {
      provider: 'composio/gmail',
      status: action === 'draft' ? 'drafted' : 'sent',
      to: params.to,
      subject: params.subject,
      action,
      raw: result.data,
    };
  }

  async getToolExecutions(agentId?: string, toolId?: string): Promise<ToolExecution[]> {
    const filter: any = {};
    if (agentId) filter.agentId = agentId;
    if (toolId) filter.toolId = toolId;
    return this.executionModel.find(filter).sort({ timestamp: -1 }).exec();
  }

  async getToolExecutionStats(): Promise<any> {
    return this.executionModel
      .aggregate([
        {
          $group: {
            _id: '$toolId',
            totalExecutions: { $sum: 1 },
            totalCost: { $sum: '$tokenCost' },
            avgExecutionTime: { $avg: '$executionTime' },
            successRate: { $avg: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          },
        },
      ])
      .exec();
  }
}
