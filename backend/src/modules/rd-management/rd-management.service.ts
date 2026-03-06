import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { basename } from 'path';
import { RdTask, RdTaskDocument, RdTaskStatus } from '../../shared/schemas/rd-task.schema';
import { RdProject, RdProjectDocument } from '../../shared/schemas/rd-project.schema';
import { Employee, EmployeeDocument } from '../../shared/schemas/employee.schema';
import { OpencodeService } from './opencode.service';
import { CreateRdTaskDto, UpdateRdTaskDto, CreateRdProjectDto, UpdateRdProjectDto, SendOpencodePromptDto, SyncOpencodeContextDto, ImportOpencodeProjectDto } from './dto';

@Injectable()
export class RdManagementService {
  private readonly logger = new Logger(RdManagementService.name);

  constructor(
    @InjectModel(RdTask.name) private rdTaskModel: Model<RdTaskDocument>,
    @InjectModel(RdProject.name) private rdProjectModel: Model<RdProjectDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    private opencodeService: OpencodeService,
  ) {}

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

  async createProject(createDto: CreateRdProjectDto): Promise<RdProject> {
    const project = new this.rdProjectModel({
      ...createDto,
    });
    return project.save();
  }

  async findAllProjects(): Promise<RdProject[]> {
    return this.rdProjectModel
      .find({})
      .populate('manager', 'name email')
      .populate('members', 'name email')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findProjectById(projectId: string): Promise<RdProject> {
    return this.rdProjectModel
      .findOne({ _id: new Types.ObjectId(projectId) })
      .populate('manager', 'name email')
      .populate('members', 'name email')
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
      .exec();
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

  async listOpencodeSessions(): Promise<any[]> {
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
    title?: string;
    config?: Record<string, any>;
  }): Promise<any> {
    return this.opencodeService.createSession(payload);
  }

  async promptOpencodeSession(payload: {
    sessionId: string;
    prompt: string;
    model?: { providerID: string; modelID: string };
  }): Promise<any> {
    return this.opencodeService.promptSession(payload.sessionId, payload.prompt, payload.model);
  }

  async importOpencodeProject(payload: ImportOpencodeProjectDto): Promise<any> {
    const projects = await this.opencodeService.listProjects();

    const matched = projects.find((project) => {
      const projectPath = project?.worktree || project?.path || project?.cwd;
      return (
        (payload.projectId && project?.id === payload.projectId) ||
        (payload.projectPath && projectPath === payload.projectPath)
      );
    });

    if (!matched && !payload.projectPath) {
      throw new BadRequestException('OpenCode project not found');
    }

    const resolvedPath =
      payload.projectPath ||
      matched?.worktree ||
      matched?.path ||
      matched?.cwd;

    if (!resolvedPath) {
      throw new BadRequestException('Invalid OpenCode project path');
    }

    const sessions = await this.opencodeService.listSessionsByProject(resolvedPath);
    const events = this.opencodeService.getRecentEvents(200, resolvedPath);
    const defaultName = basename(resolvedPath) || matched?.id || 'opencode-project';
    const projectName = payload.name?.trim() || defaultName;

    const existing = await this.rdProjectModel
      .findOne({ opencodeProjectPath: resolvedPath })
      .exec();

    const updatePayload = {
      name: projectName,
      description: `Imported from OpenCode (${resolvedPath})`,
      opencodeProjectPath: resolvedPath,
      opencodeSessionId: sessions?.[0]?.id || existing?.opencodeSessionId,
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
