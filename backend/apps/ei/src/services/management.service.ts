import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { basename } from 'path';
import { RdTask, RdTaskDocument, RdTaskStatus } from '../../../../src/shared/schemas/ei-task.schema';
import { RdProject, RdProjectDocument, RdProjectSourceType } from '../../../../src/shared/schemas/ei-project.schema';
import { Employee, EmployeeDocument } from '../../../../src/shared/schemas/employee.schema';
import { AgentClientService } from '../../../../src/modules/agents-client/agent-client.service';
import { OpencodeService } from './opencode-client.service';
import {
  BindGithubProjectDto,
  BindOpencodeProjectDto,
  CreateLocalRdProjectDto,
  CreateRdProjectDto,
  CreateRdTaskDto,
  ImportOpencodeProjectDto,
  QueryRdProjectDto,
  SendOpencodePromptDto,
  SyncAgentOpencodeProjectsDto,
  SyncOpencodeContextDto,
  UnbindOpencodeProjectDto,
  UpdateRdProjectDto,
  UpdateRdTaskDto,
} from '../dto';
import { ApiKeyService } from '../../../../src/modules/api-keys/api-key.service';

@Injectable()
export class EiManagementService {
  private readonly logger = new Logger(EiManagementService.name);

  constructor(
    @InjectModel(RdTask.name) private rdTaskModel: Model<RdTaskDocument>,
    @InjectModel(RdProject.name) private rdProjectModel: Model<RdProjectDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    private agentClientService: AgentClientService,
    private opencodeService: OpencodeService,
    private apiKeyService: ApiKeyService,
  ) {}

  private getProjectPath(project: any): string {
    return String(project?.worktree || project?.path || project?.cwd || '').trim();
  }

  private getAgentOpenCodeEndpoint(agentConfig: unknown): string | undefined {
    if (!agentConfig || typeof agentConfig !== 'object' || Array.isArray(agentConfig)) {
      return undefined;
    }

    const execution = (agentConfig as Record<string, unknown>).execution;
    if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
      return undefined;
    }

    const provider = String((execution as Record<string, unknown>).provider || '').trim().toLowerCase();
    if (provider !== 'opencode') {
      return undefined;
    }

    const endpointRef = (execution as Record<string, unknown>).endpointRef;
    if (typeof endpointRef !== 'string' || !endpointRef.trim()) {
      return undefined;
    }

    return endpointRef.trim();
  }

  private resolveSessionModelFromAgent(agent: any): { providerID: string; modelID: string } | undefined {
    const provider = String(agent?.model?.provider || '').trim();
    const modelId = String(agent?.model?.model || '').trim();
    if (provider && modelId) {
      return {
        providerID: provider,
        modelID: modelId,
      };
    }
    return undefined;
  }

  private normalizePath(input: string): string {
    const trimmed = String(input || '').trim();
    if (!trimmed) {
      return '';
    }
    if (trimmed === '/') {
      return '/';
    }
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }

  private looksLikeGithubProvider(provider: string): boolean {
    const value = String(provider || '').trim().toLowerCase();
    if (!value) {
      return false;
    }
    return value.includes('github') || value === 'git' || value === 'gh';
  }

  private async requireLocalProject(projectId: string): Promise<RdProjectDocument> {
    const project = await this.rdProjectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException('Local project not found');
    }
    if ((project.sourceType || RdProjectSourceType.OPENCODE) !== RdProjectSourceType.LOCAL) {
      throw new BadRequestException('Binding target must be a local project');
    }
    return project;
  }

  private parseOpenCodeProjectScopes(agentConfig: unknown): string[] {
    if (!agentConfig || typeof agentConfig !== 'object' || Array.isArray(agentConfig)) {
      return [];
    }

    const execution = (agentConfig as Record<string, unknown>).execution;
    if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
      return [];
    }

    const provider = String((execution as Record<string, unknown>).provider || '').trim().toLowerCase();
    if (provider !== 'opencode') {
      return [];
    }

    const paths: string[] = [];
    const pushPath = (input: unknown) => {
      if (typeof input === 'string' && input.trim()) {
        paths.push(input.trim());
      }
    };

    const executionRecord = execution as Record<string, unknown>;
    pushPath(executionRecord.projectDirectory);
    pushPath(executionRecord.projectPath);

    const projectDirectories = executionRecord.projectDirectories;
    if (Array.isArray(projectDirectories)) {
      projectDirectories.forEach((value) => pushPath(value));
    }

    return [...new Set(paths)];
  }

  private matchAgentProjectScope(projectPath: string, scopes: string[]): boolean {
    if (!projectPath || scopes.length === 0) {
      return scopes.length === 0;
    }

    const normalizedPath = this.normalizePath(projectPath);
    return scopes.some((scope) => {
      const normalizedScope = this.normalizePath(scope);
      if (!normalizedScope) {
        return false;
      }
      if (normalizedScope === '/') {
        return normalizedPath === '/';
      }
      return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
    });
  }

  private async resolveEmployeeObjectId(employeeId?: string): Promise<Types.ObjectId | undefined> {
    if (!employeeId) {
      return undefined;
    }

    if (Types.ObjectId.isValid(employeeId)) {
      return new Types.ObjectId(employeeId);
    }

    const employee = await this.employeeModel.findOne({ id: employeeId }).select('_id').exec();
    if (!employee?._id) {
      return undefined;
    }

    return employee._id as Types.ObjectId;
  }

  // ========== 任务管理 ==========

  async createTask(createDto: CreateRdTaskDto, userId: string): Promise<RdTask> {
    const createdByObjectId = await this.resolveEmployeeObjectId(userId);

    const task = new this.rdTaskModel({
      ...createDto,
      ...(createdByObjectId && { createdBy: createdByObjectId }),
      status: RdTaskStatus.PENDING,
    });

    // 如果有关联项目，获取项目的opencode配置
    if (createDto.projectId) {
      const project = await this.rdProjectModel.findById(createDto.projectId);
      if (project) {
        task.opencodeProjectPath = project.opencodeProjectPath;
        task.opencodeConfig = project.opencodeConfig;
      }
    }

    return task.save();
  }

  async findAllTasks(filters?: any): Promise<RdTask[]> {
    const query: any = {};
    
    if (filters?.status) query.status = filters.status;
    if (filters?.assignee) {
      const assigneeObjectId = await this.resolveEmployeeObjectId(filters.assignee);
      if (assigneeObjectId) {
        query.assignee = assigneeObjectId;
      }
    }
    if (filters?.priority) query.priority = filters.priority;
    
    return this.rdTaskModel
      .find(query)
      .populate('assignee', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findTaskById(taskId: string): Promise<RdTask> {
    return this.rdTaskModel
      .findOne({ _id: new Types.ObjectId(taskId) })
      .populate('assignee', 'name email')
      .populate('createdBy', 'name email')
      .exec();
  }

  async updateTask(taskId: string, updateDto: UpdateRdTaskDto): Promise<RdTask> {
    return this.rdTaskModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(taskId) },
        { $set: updateDto },
        { new: true },
      )
      .populate('assignee', 'name email')
      .exec();
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const result = await this.rdTaskModel.deleteOne({
      _id: new Types.ObjectId(taskId),
    });
    return result.deletedCount > 0;
  }

  // ========== 项目管理 ==========

  async createProject(_createDto: CreateRdProjectDto): Promise<RdProject> {
    throw new BadRequestException('EI projects can only be created through OpenCode sync');
  }

  async createLocalProject(createDto: CreateLocalRdProjectDto): Promise<RdProject> {
    const localPath = String(createDto.localPath || '').trim();
    if (!localPath) {
      throw new BadRequestException('localPath is required');
    }

    const normalizedPath = this.normalizePath(localPath);
    const existing = await this.rdProjectModel
      .findOne({
        sourceType: RdProjectSourceType.LOCAL,
        localPath: normalizedPath,
      })
      .exec();

    const payload = {
      name: String(createDto.name || '').trim() || basename(localPath) || 'local-project',
      description: createDto.description?.trim() || '',
      sourceType: RdProjectSourceType.LOCAL,
      localPath: normalizedPath,
      createdBySync: false,
      metadata: {
        ...(existing?.metadata || {}),
        ...(createDto.metadata || {}),
      },
    };

    if (existing) {
      return this.rdProjectModel
        .findOneAndUpdate({ _id: existing._id }, { $set: payload }, { new: true })
        .populate('manager', 'name email')
        .populate('members', 'name email')
        .populate('opencodeBindingIds', 'name opencodeProjectPath opencodeProjectId opencodeEndpointRef sourceType')
        .populate('githubBindingId', 'name repositoryUrl githubOwner githubRepo branch sourceType githubApiKeyId')
        .exec();
    }

    return new this.rdProjectModel(payload).save();
  }

  async findAllProjects(filters?: QueryRdProjectDto): Promise<RdProject[]> {
    const query: Record<string, any> = {};
    if (filters?.syncedFromAgentId) {
      query.syncedFromAgentId = filters.syncedFromAgentId;
    }
    if (filters?.sourceType) {
      query.sourceType = filters.sourceType;
    }
    if (filters?.bindingLocalProjectId) {
      query.bindingLocalProjectId = new Types.ObjectId(filters.bindingLocalProjectId);
    }

    return this.rdProjectModel
      .find(query)
      .populate('manager', 'name email')
      .populate('members', 'name email')
      .populate('opencodeBindingIds', 'name opencodeProjectPath opencodeProjectId opencodeEndpointRef sourceType')
      .populate('githubBindingId', 'name repositoryUrl githubOwner githubRepo branch sourceType githubApiKeyId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findProjectById(projectId: string): Promise<RdProject> {
    return this.rdProjectModel
      .findOne({ _id: new Types.ObjectId(projectId) })
      .populate('manager', 'name email')
      .populate('members', 'name email')
      .populate('opencodeBindingIds', 'name opencodeProjectPath opencodeProjectId opencodeEndpointRef sourceType')
      .populate('githubBindingId', 'name repositoryUrl githubOwner githubRepo branch sourceType githubApiKeyId')
      .exec();
  }

  async updateProject(projectId: string, updateDto: UpdateRdProjectDto): Promise<RdProject> {
    return this.rdProjectModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(projectId) },
        { $set: updateDto },
        { new: true },
      )
      .populate('manager', 'name email')
      .populate('members', 'name email')
      .populate('opencodeBindingIds', 'name opencodeProjectPath opencodeProjectId opencodeEndpointRef sourceType')
      .populate('githubBindingId', 'name repositoryUrl githubOwner githubRepo branch sourceType githubApiKeyId')
      .exec();
  }

  async bindOpencodeProject(payload: BindOpencodeProjectDto): Promise<RdProject> {
    const localProject = await this.requireLocalProject(payload.localProjectId);

    const importResult = await this.importOpencodeProject({
      projectId: payload.projectId,
      projectPath: payload.projectPath,
      endpointRef: payload.endpointRef,
      agentId: payload.agentId,
      name: payload.name,
    });

    const opencodeProject = importResult.project as RdProjectDocument;
    if (!opencodeProject?._id) {
      throw new BadRequestException('Failed to bind OpenCode project');
    }

    const previousLocalBindingId = opencodeProject.bindingLocalProjectId
      ? String(opencodeProject.bindingLocalProjectId)
      : '';
    const currentLocalBindingId = String(localProject._id);

    if (previousLocalBindingId && previousLocalBindingId !== currentLocalBindingId) {
      await this.rdProjectModel.updateOne(
        { _id: new Types.ObjectId(previousLocalBindingId) },
        { $pull: { opencodeBindingIds: opencodeProject._id } },
      );
    }

    await this.rdProjectModel.updateOne(
      { _id: opencodeProject._id },
      { $set: { bindingLocalProjectId: localProject._id } },
    );

    const updatedLocal = await this.rdProjectModel
      .findOneAndUpdate(
        { _id: localProject._id },
        { $addToSet: { opencodeBindingIds: opencodeProject._id } },
        { new: true },
      )
      .populate('manager', 'name email')
      .populate('members', 'name email')
      .populate('opencodeBindingIds', 'name opencodeProjectPath opencodeProjectId opencodeEndpointRef sourceType')
      .populate('githubBindingId', 'name repositoryUrl githubOwner githubRepo branch sourceType githubApiKeyId')
      .exec();

    return updatedLocal;
  }

  async bindGithubProject(payload: BindGithubProjectDto): Promise<RdProject> {
    const localProject = await this.requireLocalProject(payload.localProjectId);

    const apiKey = await this.apiKeyService.getApiKey(payload.githubApiKeyId);
    if (!apiKey || !apiKey.isActive) {
      throw new BadRequestException('Invalid githubApiKeyId or API key is inactive');
    }
    if (!this.looksLikeGithubProvider(apiKey.provider || '')) {
      this.logger.warn(
        `Binding github repo with non-standard api key provider: ${apiKey.provider || 'unknown'} (id=${payload.githubApiKeyId})`,
      );
    }

    const owner = String(payload.owner || '').trim();
    const repo = String(payload.repo || '').trim();
    if (!owner || !repo) {
      throw new BadRequestException('owner and repo are required');
    }

    const githubName = payload.name?.trim() || `${owner}/${repo}`;
    const existingGithubBinding = localProject.githubBindingId
      ? await this.rdProjectModel.findById(localProject.githubBindingId).exec()
      : await this.rdProjectModel
          .findOne({
            sourceType: RdProjectSourceType.GITHUB,
            bindingLocalProjectId: localProject._id,
          })
          .exec();

    const basePayload = {
      name: githubName,
      description: payload.description?.trim() || existingGithubBinding?.description || '',
      sourceType: RdProjectSourceType.GITHUB,
      bindingLocalProjectId: localProject._id,
      repositoryUrl: payload.repositoryUrl.trim(),
      githubOwner: owner,
      githubRepo: repo,
      githubApiKeyId: payload.githubApiKeyId,
      branch: payload.branch?.trim() || existingGithubBinding?.branch || 'main',
      createdBySync: false,
      metadata: {
        ...(existingGithubBinding?.metadata || {}),
        ...(payload.metadata || {}),
      },
    };

    const githubProject = existingGithubBinding
      ? await this.rdProjectModel
          .findOneAndUpdate({ _id: existingGithubBinding._id }, { $set: basePayload }, { new: true })
          .exec()
      : await new this.rdProjectModel(basePayload).save();

    const updatedLocal = await this.rdProjectModel
      .findOneAndUpdate(
        { _id: localProject._id },
        { $set: { githubBindingId: githubProject._id } },
        { new: true },
      )
      .populate('manager', 'name email')
      .populate('members', 'name email')
      .populate('opencodeBindingIds', 'name opencodeProjectPath opencodeProjectId opencodeEndpointRef sourceType')
      .populate('githubBindingId', 'name repositoryUrl githubOwner githubRepo branch sourceType githubApiKeyId')
      .exec();

    return updatedLocal;
  }

  async unbindOpencodeProject(localProjectId: string, payload: UnbindOpencodeProjectDto): Promise<RdProject> {
    const localProject = await this.requireLocalProject(localProjectId);
    const bindingId = new Types.ObjectId(payload.opencodeBindingId);

    const opencodeProject = await this.rdProjectModel.findById(bindingId).exec();
    if (!opencodeProject) {
      throw new NotFoundException('OpenCode binding project not found');
    }
    if ((opencodeProject.sourceType || RdProjectSourceType.OPENCODE) !== RdProjectSourceType.OPENCODE) {
      throw new BadRequestException('Only opencode project can be unbound');
    }

    const boundToLocalId = String(opencodeProject.bindingLocalProjectId || '');
    if (!boundToLocalId || boundToLocalId !== String(localProject._id)) {
      throw new BadRequestException('OpenCode project is not bound to this local project');
    }

    await this.rdProjectModel.updateOne(
      { _id: opencodeProject._id },
      { $unset: { bindingLocalProjectId: '' } },
    );

    const updatedLocal = await this.rdProjectModel
      .findOneAndUpdate(
        { _id: localProject._id },
        { $pull: { opencodeBindingIds: opencodeProject._id } },
        { new: true },
      )
      .populate('manager', 'name email')
      .populate('members', 'name email')
      .populate('opencodeBindingIds', 'name opencodeProjectPath opencodeProjectId opencodeEndpointRef sourceType')
      .populate('githubBindingId', 'name repositoryUrl githubOwner githubRepo branch sourceType githubApiKeyId')
      .exec();

    return updatedLocal;
  }

  async unbindGithubProject(localProjectId: string): Promise<RdProject> {
    const localProject = await this.requireLocalProject(localProjectId);
    const githubBindingId = localProject.githubBindingId;

    if (!githubBindingId) {
      return this.findProjectById(String(localProject._id));
    }

    const githubId = new Types.ObjectId(githubBindingId);
    const githubProject = await this.rdProjectModel.findById(githubId).exec();

    if (!githubProject) {
      return this.rdProjectModel
        .findOneAndUpdate(
          { _id: localProject._id },
          { $unset: { githubBindingId: '' } },
          { new: true },
        )
        .populate('manager', 'name email')
        .populate('members', 'name email')
        .populate('opencodeBindingIds', 'name opencodeProjectPath opencodeProjectId opencodeEndpointRef sourceType')
        .populate('githubBindingId', 'name repositoryUrl githubOwner githubRepo branch sourceType githubApiKeyId')
        .exec();
    }

    if ((githubProject.sourceType || RdProjectSourceType.OPENCODE) !== RdProjectSourceType.GITHUB) {
      throw new BadRequestException('Current github binding is invalid');
    }

    await this.rdProjectModel.deleteOne({ _id: githubProject._id }).exec();

    const updatedLocal = await this.rdProjectModel
      .findOneAndUpdate(
        { _id: localProject._id },
        { $unset: { githubBindingId: '' } },
        { new: true },
      )
      .populate('manager', 'name email')
      .populate('members', 'name email')
      .populate('opencodeBindingIds', 'name opencodeProjectPath opencodeProjectId opencodeEndpointRef sourceType')
      .populate('githubBindingId', 'name repositoryUrl githubOwner githubRepo branch sourceType githubApiKeyId')
      .exec();

    return updatedLocal;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const result = await this.rdProjectModel.deleteOne({
      _id: new Types.ObjectId(projectId),
    });
    return result.deletedCount > 0;
  }

  // ========== OpenCode 集成 ==========

  async sendOpencodePrompt(taskId: string, promptDto: SendOpencodePromptDto): Promise<any> {
    const task = await this.findTaskById(taskId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // 更新任务状态为进行中
    if (task.status === RdTaskStatus.PENDING) {
      await this.updateTask(taskId, { status: RdTaskStatus.IN_PROGRESS, startedAt: new Date() });
    }

    try {
      // 发送prompt到opencode
      const response = await this.opencodeService.sendPrompt({
        sessionId: task.opencodeSessionId,
        projectPath: task.opencodeProjectPath || promptDto.projectPath,
        prompt: promptDto.prompt,
        model: promptDto.model,
        config: { ...task.opencodeConfig, ...promptDto.config },
      });

      // 保存消息记录
      const message = {
        role: 'user',
        content: promptDto.prompt,
        timestamp: new Date(),
      };

      const assistantMessage = {
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
        metadata: response.metadata,
      };

      await this.rdTaskModel.updateOne(
        { _id: new Types.ObjectId(taskId) },
        {
          $push: { opencodeMessages: { $each: [message, assistantMessage] } },
          $set: {
            lastOpencodeResponse: response.content,
            opencodeSessionId: response.sessionId,
          },
        },
      );

      return {
        success: true,
        response: response.content,
        sessionId: response.sessionId,
        task,
      };
    } catch (error) {
      this.logger.error(`Failed to send opencode prompt: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createOpencodeSession(taskId: string, projectPath: string): Promise<any> {
    const task = await this.findTaskById(taskId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    try {
      const session = await this.opencodeService.createSession({
        projectPath,
        title: task.title,
        config: task.opencodeConfig,
      });

      await this.rdTaskModel.updateOne(
        { _id: new Types.ObjectId(taskId) },
        {
          $set: {
            opencodeSessionId: session.id,
            opencodeProjectPath: projectPath,
          },
        },
      );

      return {
        success: true,
        sessionId: session.id,
        task,
      };
    } catch (error) {
      this.logger.error(`Failed to create opencode session: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getOpencodeSessionHistory(taskId: string): Promise<any> {
    const task = await this.findTaskById(taskId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (!task.opencodeSessionId) {
      return { messages: [] };
    }

    try {
      const history = await this.opencodeService.getSessionHistory(task.opencodeSessionId);
      return {
        messages: task.opencodeMessages || [],
        opencodeHistory: history,
      };
    } catch (error) {
      this.logger.error(`Failed to get session history: ${error.message}`, error.stack);
      return { messages: task.opencodeMessages || [] };
    }
  }

  async completeTask(taskId: string, result: any): Promise<RdTask> {
    return this.updateTask(
      taskId,
      {
        status: RdTaskStatus.COMPLETED,
        completedAt: new Date(),
        result,
      },
    );
  }

  async getCurrentOpencodeContext(): Promise<any> {
    return this.opencodeService.getCurrentContext();
  }

  async listOpencodeProjects(): Promise<any[]> {
    return this.opencodeService.listProjects();
  }

  async listOpencodeSessions(directory?: string): Promise<any[]> {
    if (directory?.trim()) {
      return this.opencodeService.listSessionsByProject(directory.trim());
    }
    return this.opencodeService.listSessions();
  }

  async getOpencodeSession(sessionId: string): Promise<any> {
    const session = await this.opencodeService.getSession(sessionId);
    if (!session) {
      throw new NotFoundException('OpenCode session not found');
    }
    return session;
  }

  async getOpencodeSessionMessages(sessionId: string): Promise<any[]> {
    return this.opencodeService.getSessionHistory(sessionId);
  }

  async createStandaloneOpencodeSession(payload: {
    projectPath: string;
    agentId?: string;
    title?: string;
    config?: Record<string, any>;
    model?: { providerID: string; modelID: string };
  }): Promise<any> {
    let resolvedModel = payload.model;

    if (!resolvedModel && payload.agentId?.trim()) {
      const agent = await this.agentClientService.getAgent(payload.agentId.trim());
      resolvedModel = this.resolveSessionModelFromAgent(agent);
    }

    try {
      return await this.opencodeService.createSession({
        projectPath: payload.projectPath,
        title: payload.title,
        config: payload.config,
        model: resolvedModel,
      });
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error || 'Failed to create OpenCode session');
      if (message.includes('OpenCode 不支持当前 Agent 模型')) {
        throw new BadRequestException(message);
      }
      throw error;
    }
  }

  async promptOpencodeSession(payload: {
    sessionId: string;
    prompt: string;
    model?: { providerID: string; modelID: string };
  }): Promise<any> {
    try {
      return await this.opencodeService.promptSession(payload.sessionId, payload.prompt, payload.model);
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error || 'Failed to prompt OpenCode session');
      if (message.includes('OpenCode 不支持当前 Agent 模型')) {
        throw new BadRequestException(message);
      }
      throw error;
    }
  }

  async importOpencodeProject(payload: ImportOpencodeProjectDto): Promise<any> {
    const endpointRef = payload.endpointRef?.trim() || undefined;
    const projects = await this.opencodeService.listProjects(endpointRef);

    const matched = projects.find((project) => {
      const projectPath = this.getProjectPath(project);
      return (
        (payload.projectId && project?.id === payload.projectId) ||
        (payload.projectPath && projectPath === payload.projectPath)
      );
    });

    if (!matched && !payload.projectPath) {
      throw new BadRequestException('OpenCode project not found');
    }

    const resolvedPath = payload.projectPath || this.getProjectPath(matched);
    if (!resolvedPath) {
      throw new BadRequestException('Invalid OpenCode project path');
    }

    const sessions = await this.opencodeService.listSessionsByProject(resolvedPath, endpointRef);
    const events = this.opencodeService.getRecentEvents(200, resolvedPath);
    const defaultName = basename(resolvedPath) || matched?.id || 'opencode-project';
    const projectName = payload.name?.trim() || defaultName;
    const syncedFromAgentId = payload.agentId?.trim() || undefined;

    const existingQuery: Record<string, any> = {
      $or: [
        { opencodeProjectPath: resolvedPath },
        ...(matched?.id ? [{ opencodeProjectId: matched.id }] : []),
      ],
    };
    if (syncedFromAgentId) {
      existingQuery.syncedFromAgentId = syncedFromAgentId;
    }

    const existing = await this.rdProjectModel.findOne(existingQuery).exec();

    const updatePayload = {
      name: projectName,
      description: `Synced from OpenCode (${resolvedPath})`,
      sourceType: RdProjectSourceType.OPENCODE,
      opencodeProjectId: matched?.id,
      opencodeProjectPath: resolvedPath,
      opencodeEndpointRef: endpointRef,
      opencodeSessionId: sessions?.[0]?.id || existing?.opencodeSessionId,
      createdBySync: true,
      ...(syncedFromAgentId ? { syncedFromAgentId } : {}),
      metadata: {
        ...(existing?.metadata || {}),
        opencodeImport: {
          project: matched || { path: resolvedPath },
          sessions,
          events,
          importedAt: new Date().toISOString(),
        },
      },
    };

    const project = existing
      ? await this.rdProjectModel
          .findOneAndUpdate(
            { _id: existing._id },
            { $set: updatePayload },
            { new: true },
          )
          .exec()
      : await new this.rdProjectModel({
          ...updatePayload,
        }).save();

    return {
      project,
      importedSessions: sessions.length,
      importedEvents: events.length,
      syncedFromAgentId,
      endpointRef: endpointRef || null,
    };
  }

  async syncAgentOpencodeProjects(agentId: string, syncDto: SyncAgentOpencodeProjectsDto): Promise<any> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
      throw new BadRequestException('agentId is required');
    }

    const agent = await this.agentClientService.getAgent(normalizedAgentId);

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    const configuredScopes = this.parseOpenCodeProjectScopes(agent.config);
    const requestedScopes = Array.isArray(syncDto.projectPaths)
      ? syncDto.projectPaths.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const finalScopes = requestedScopes.length > 0 ? requestedScopes : configuredScopes;

    const endpointRef = this.getAgentOpenCodeEndpoint(agent.config);
    let opencodeProjects: any[] = [];
    try {
      opencodeProjects = await this.opencodeService.listProjects(endpointRef, { throwOnError: Boolean(endpointRef) });
    } catch (error: any) {
      throw new BadRequestException(
        `Failed to query OpenCode endpoint ${endpointRef}: ${error?.message || error}`,
      );
    }
    const candidates = opencodeProjects.filter((item) => {
      const path = this.getProjectPath(item);
      return this.matchAgentProjectScope(path, finalScopes);
    });

    const stats = {
      totalCandidates: candidates.length,
      created: 0,
      updated: 0,
      skipped: 0,
    };

    const syncedProjects: any[] = [];

    for (const project of candidates) {
      const path = this.getProjectPath(project);
      if (!path) {
        stats.skipped += 1;
        continue;
      }

      const existing = await this.rdProjectModel
        .findOne({
          syncedFromAgentId: normalizedAgentId,
          $or: [
            { opencodeProjectPath: path },
            ...(project?.id ? [{ opencodeProjectId: project.id }] : []),
          ],
        })
        .exec();

      const importResult = await this.importOpencodeProject({
        projectId: project?.id,
        projectPath: path,
        name: basename(path) || project?.id,
        agentId: normalizedAgentId,
        endpointRef,
      });

      if (existing) {
        stats.updated += 1;
      } else {
        stats.created += 1;
      }
      syncedProjects.push(importResult.project);
    }

    return {
      agentId: normalizedAgentId,
      endpointRef: endpointRef || null,
      scopes: finalScopes,
      stats,
      projects: syncedProjects,
    };
  }

  async subscribeOpencodeEvents(handlers: {
    onEvent: (event: any) => void;
    onError?: (error: any) => void;
    onComplete?: () => void;
  }): Promise<() => void> {
    return this.opencodeService.subscribeEvents(handlers);
  }

  async syncCurrentOpencodeToTask(taskId: string): Promise<RdTask> {
    return this.syncOpencodeToTask(taskId, {});
  }

  async syncOpencodeToTask(taskId: string, syncDto: SyncOpencodeContextDto): Promise<RdTask> {
    const task = await this.findTaskById(taskId);
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    let sessionId = syncDto.sessionId;
    let projectPath = syncDto.projectPath;

    if (!sessionId || !projectPath) {
      const context = await this.opencodeService.getCurrentContext();
      if (!context.available) {
        throw new BadRequestException(context.error || 'OpenCode context is unavailable');
      }
      sessionId = sessionId || context.currentSession?.id;
      projectPath =
        projectPath ||
        context.path?.cwd ||
        context.path?.root ||
        context.project?.path ||
        context.project?.root ||
        task.opencodeProjectPath;
    }

    if (!sessionId) {
      throw new BadRequestException('No OpenCode session available to sync');
    }

    return this.rdTaskModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(taskId) },
        {
          $set: {
            opencodeSessionId: sessionId,
            opencodeProjectPath: projectPath,
          },
        },
        { new: true },
      )
      .populate('assignee', 'name email')
      .populate('createdBy', 'name email')
      .exec();
  }

  async syncCurrentOpencodeToProject(projectId: string): Promise<RdProject> {
    return this.syncOpencodeToProject(projectId, {});
  }

  async syncOpencodeToProject(projectId: string, syncDto: SyncOpencodeContextDto): Promise<RdProject> {
    const project = await this.findProjectById(projectId);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    let sessionId = syncDto.sessionId;
    let projectPath = syncDto.projectPath;

    if (!sessionId || !projectPath) {
      const context = await this.opencodeService.getCurrentContext();
      if (!context.available) {
        throw new BadRequestException(context.error || 'OpenCode context is unavailable');
      }

      sessionId = sessionId || context.currentSession?.id;
      projectPath =
        projectPath ||
        context.path?.cwd ||
        context.path?.root ||
        context.project?.path ||
        context.project?.root ||
        project.opencodeProjectPath;
    }

    return this.rdProjectModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(projectId) },
        {
          $set: {
            opencodeProjectPath: projectPath,
            opencodeSessionId: sessionId,
          },
        },
        { new: true },
      )
      .populate('manager', 'name email')
      .populate('members', 'name email')
      .exec();
  }
}
