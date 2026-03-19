import { Injectable, Logger, ConflictException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Employee, EmployeeDocument, EmployeeType, EmployeeStatus, EmployeeRole } from '../../shared/schemas/employee.schema';
import { AgentClientService } from '../agents-client/agent-client.service';
import { v4 as uuidv4 } from 'uuid';
import { AVAILABLE_MODELS } from '../../config/models';
import type { AIModel, Agent } from '../../shared/types';
import { AgentRoleTier, getTierByEmployeeRole, normalizeAgentRoleTier } from '../../shared/role-tier';

export interface CreateEmployeeDto {
  type: EmployeeType;
  // 人类员工字段
  userId?: string;
  name?: string;
  email?: string;
  avatar?: string;
  // 共同字段
  role: EmployeeRole;
  tier?: AgentRoleTier;
  departmentId?: string;
  title?: string;
  description?: string;
  salary?: number;
  shares?: number;
  stockOptions?: number;
  capabilities?: string[];
  allowAIProxy?: boolean;
  aiProxyAgentId?: string;
  exclusiveAssistantAgentId?: string;
}

export interface UpdateEmployeeDto {
  name?: string;
  email?: string;
  avatar?: string;
  role?: EmployeeRole;
  tier?: AgentRoleTier;
  departmentId?: string;
  title?: string;
  description?: string;
  status?: EmployeeStatus;
  salary?: number;
  shares?: number;
  stockOptions?: number;
  capabilities?: string[];
  permissions?: string[];
  toolAccess?: string[];
  allowAIProxy?: boolean;
  aiProxyAgentId?: string;
  exclusiveAssistantAgentId?: string;
  meetingPreferences?: Employee['meetingPreferences'];
}

export interface EmployeeStats {
  total: number;
  byType: Array<{ _id: string; count: number }>;
  byStatus: Array<{ _id: string; count: number }>;
  byDepartment: Array<{ _id: string; count: number }>;
  humans: number;
  agents: number;
}

@Injectable()
export class EmployeeService implements OnModuleInit {
  private readonly logger = new Logger(EmployeeService.name);

  constructor(
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    private readonly agentClientService: AgentClientService,
  ) {}

  async onModuleInit(): Promise<void> {
    const purgeResult = await this.employeeModel.deleteMany({ type: EmployeeType.AGENT }).exec();
    if (purgeResult.deletedCount) {
      this.logger.warn(`Purged legacy AI agent employees: ${purgeResult.deletedCount}`);
    }
  }

  private pickDefaultAssistantModel(): AIModel {
    const preferredIds = ['gpt-4o-mini', 'gpt-4o', 'claude-sonnet-4-6', 'gemini-1.5-flash'];
    for (const modelId of preferredIds) {
      const found = AVAILABLE_MODELS.find((model) => model.id === modelId);
      if (found) {
        return found;
      }
    }

    return AVAILABLE_MODELS[0];
  }

  private async buildAssistantName(baseName: string): Promise<string> {
    const allAgents = await this.agentClientService.getAllAgents();
    const taken = new Set(
      (allAgents || [])
        .map((agent) => String(agent.name || '').trim().toLowerCase())
        .filter(Boolean),
    );

    const normalizedBase = baseName.trim() || '专属助理';
    if (!taken.has(normalizedBase.toLowerCase())) {
      return normalizedBase;
    }

    for (let idx = 2; idx <= 999; idx += 1) {
      const candidate = `${normalizedBase} ${idx}`;
      if (!taken.has(candidate.toLowerCase())) {
        return candidate;
      }
    }

    return `${normalizedBase} ${Date.now()}`;
  }

  private buildAssistantDisplayName(ownerName: string): string {
    const normalized = ownerName.trim();
    if (!normalized) {
      return '专属助理';
    }
    return `${normalized} 的专属助理`;
  }

  private async attachAssistantNames(employees: EmployeeDocument[]): Promise<Array<Employee & { exclusiveAssistantName?: string }>> {
    const assistantIds = Array.from(
      new Set(
        employees
          .map((employee) => employee.exclusiveAssistantAgentId || employee.aiProxyAgentId)
          .filter((id): id is string => !!id),
      ),
    );

    if (assistantIds.length === 0) {
      return employees.map((employee) => employee.toObject());
    }

    const nameById = new Map<string, string>();
    try {
      const allAgents = await this.agentClientService.getAllAgents();
      for (const agent of allAgents || []) {
        const id = String((agent as Agent).id || '').trim();
        if (!id) {
          continue;
        }
        nameById.set(id, String(agent.name || '').trim());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to resolve assistant names from agents service: ${message}`);
    }

    return employees.map((employee) => {
      const assistantId = employee.exclusiveAssistantAgentId || employee.aiProxyAgentId;
      const assistantName = assistantId ? nameById.get(assistantId) : undefined;
      return {
        ...employee.toObject(),
        exclusiveAssistantName: assistantName || undefined,
      };
    });
  }

  /**
   * 创建员工（人类或Agent）
   */
  async createEmployee(dto: CreateEmployeeDto): Promise<Employee> {
    if (dto.type !== EmployeeType.HUMAN) {
      throw new ConflictException('AI Agent employee identity has been removed; only human employees are supported');
    }

    // 验证必填字段
    if (!dto.name) {
      throw new ConflictException('Human employee must have a name');
    }

    // 检查是否已存在
    if (dto.userId) {
      const existing = await this.employeeModel.findOne({
        userId: dto.userId,
      }).exec();
      if (existing) {
        throw new ConflictException('User is already an employee');
      }
    }

    if (dto.exclusiveAssistantAgentId) {
      const assistantAgent = await this.agentClientService.getAgent(dto.exclusiveAssistantAgentId);
      if (!assistantAgent) {
        throw new ConflictException('Exclusive assistant agent does not exist or is unavailable');
      }

      const duplicateAssistant = await this.employeeModel.findOne({
        type: EmployeeType.HUMAN,
        $or: [
          { exclusiveAssistantAgentId: dto.exclusiveAssistantAgentId },
          { aiProxyAgentId: dto.exclusiveAssistantAgentId },
        ],
      }).exec();
      if (duplicateAssistant) {
        throw new ConflictException('This agent is already bound as another human account assistant');
      }
    }

    const roleTier = this.resolveEmployeeTierOrThrow(dto.tier, dto.role);

    const employee = new this.employeeModel({
      id: uuidv4(),
      type: dto.type,
      userId: dto.userId,
      name: dto.name,
      email: dto.email,
      avatar: dto.avatar,
      role: dto.role,
      tier: roleTier,
      departmentId: dto.departmentId,
      title: dto.title || this.getDefaultTitle(dto.role),
      description: dto.description,
      joinDate: new Date(),
      status: dto.role === EmployeeRole.FOUNDER || dto.role === EmployeeRole.CO_FOUNDER 
        ? EmployeeStatus.ACTIVE 
        : EmployeeStatus.PROBATION,
      probationEndDate: dto.role === EmployeeRole.FOUNDER || dto.role === EmployeeRole.CO_FOUNDER
        ? undefined
        : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90天试用期
      salary: dto.salary || 0,
      shares: dto.shares || 0,
      stockOptions: dto.stockOptions || 0,
      capabilities: dto.capabilities || [],
      allowAIProxy: dto.allowAIProxy || false,
      aiProxyAgentId: dto.aiProxyAgentId,
      exclusiveAssistantAgentId: dto.exclusiveAssistantAgentId || dto.aiProxyAgentId,
      meetingPreferences: {
        autoJoin: true,
        notifications: true,
        preferredMeetingTypes: [],
      },
      performance: {
        overallScore: 0,
        taskCompletionRate: 0,
        codeQuality: 0,
        collaboration: 0,
        innovation: 0,
        efficiency: 0,
        totalEvaluations: 0,
      },
      statistics: {
        totalTasks: 0,
        completedTasks: 0,
        totalTokens: 0,
        totalCost: 0,
        meetingsAttended: 0,
        meetingsHosted: 0,
      },
    });

    const saved = await employee.save();
    this.logger.log(`Created ${dto.type} employee: ${saved.name || saved.id}`);

    return saved;
  }

  /**
   * 获取组织下的所有员工
   */
  async getEmployeesByOrganization(
    filters?: { type?: EmployeeType; status?: EmployeeStatus; departmentId?: string }
  ): Promise<Array<Employee & { exclusiveAssistantName?: string }>> {
    if (filters?.type && filters.type !== EmployeeType.HUMAN) {
      return [];
    }

    const query: any = { type: EmployeeType.HUMAN };
    if (filters?.status) query.status = filters.status;
    if (filters?.departmentId) query.departmentId = filters.departmentId;

    const employees = await this.employeeModel.find(query).sort({ createdAt: -1 }).exec();
    return this.attachAssistantNames(employees);
  }

  /**
   * 获取单个员工
   */
  async getEmployee(employeeId: string): Promise<Employee | null> {
    return this.employeeModel.findOne({ id: employeeId }).exec();
  }

  /**
   * 通过Agent ID获取员工
   */
  async getEmployeeByAgentId(agentId: string): Promise<Employee | null> {
    return this.employeeModel.findOne({ agentId }).exec();
  }

  /**
   * 通过用户ID获取员工
   */
  async getEmployeeByUserId(userId: string): Promise<Employee | null> {
    return this.employeeModel.findOne({ userId }).exec();
  }

  /**
   * 更新员工信息
   */
  async updateEmployee(employeeId: string, dto: UpdateEmployeeDto): Promise<Employee | null> {
    const existing = await this.employeeModel.findOne({ id: employeeId }).exec();
    if (!existing) {
      return null;
    }

    const normalizedUpdate: UpdateEmployeeDto = { ...dto };
    const nextRole = dto.role || existing.role;
    if (dto.role !== undefined || dto.tier !== undefined) {
      normalizedUpdate.tier = this.resolveEmployeeTierOrThrow(dto.tier, nextRole);
    }
    if (dto.exclusiveAssistantAgentId !== undefined) {
      if (dto.exclusiveAssistantAgentId) {
        const assistantAgent = await this.agentClientService.getAgent(dto.exclusiveAssistantAgentId);
        if (!assistantAgent) {
          throw new ConflictException('Exclusive assistant agent does not exist or is unavailable');
        }

        const duplicateAssistant = await this.employeeModel.findOne({
          id: { $ne: employeeId },
          type: EmployeeType.HUMAN,
          $or: [
            { exclusiveAssistantAgentId: dto.exclusiveAssistantAgentId },
            { aiProxyAgentId: dto.exclusiveAssistantAgentId },
          ],
        }).exec();
        if (duplicateAssistant) {
          throw new ConflictException('This agent is already bound as another human account assistant');
        }
      }

      normalizedUpdate.aiProxyAgentId = dto.exclusiveAssistantAgentId || undefined;
      normalizedUpdate.allowAIProxy = !!dto.exclusiveAssistantAgentId;
    }

    const updated = await this.employeeModel.findOneAndUpdate(
      { id: employeeId },
      { ...normalizedUpdate, updatedAt: new Date() },
      { new: true }
    ).exec();

    const nextName = String(dto.name || '').trim();
    const prevName = String(existing.name || '').trim();
    const assistantAgentId = updated?.exclusiveAssistantAgentId || updated?.aiProxyAgentId;
    const shouldSyncAssistantName = !!updated && !!assistantAgentId && !!nextName && nextName !== prevName;
    if (shouldSyncAssistantName && assistantAgentId) {
      const targetAssistantName = this.buildAssistantDisplayName(nextName);
      await this.agentClientService.updateAgent(assistantAgentId, { name: targetAssistantName });
    }

    if (updated) {
      this.logger.log(`Updated employee: ${employeeId}`);
    }

    return updated;
  }

  /**
   * 删除员工
   */
  async deleteEmployee(employeeId: string): Promise<boolean> {
    const result = await this.employeeModel.findOneAndDelete({ id: employeeId }).exec();
    if (result) {
      this.logger.log(`Deleted employee: ${employeeId}`);
      return true;
    }
    return false;
  }

  /**
   * 转正员工（试用期结束）
   */
  async confirmEmployee(employeeId: string): Promise<Employee | null> {
    return this.employeeModel.findOneAndUpdate(
      { id: employeeId },
      { 
        status: EmployeeStatus.ACTIVE,
        probationEndDate: new Date(),
        updatedAt: new Date(),
      },
      { new: true }
    ).exec();
  }

  /**
   * 解雇员工
   */
  async terminateEmployee(employeeId: string, reason?: string): Promise<Employee | null> {
    return this.employeeModel.findOneAndUpdate(
      { id: employeeId },
      { 
        status: EmployeeStatus.TERMINATED,
        updatedAt: new Date(),
      },
      { new: true }
    ).exec();
  }

  /**
   * 获取员工统计
   */
  async getEmployeeStats(): Promise<EmployeeStats> {
    const total = await this.employeeModel.countDocuments({ type: EmployeeType.HUMAN });
    
    const byType = await this.employeeModel.aggregate([
      { $match: { type: EmployeeType.HUMAN } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);

    const byStatus = await this.employeeModel.aggregate([
      { $match: { type: EmployeeType.HUMAN } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const byDepartment = await this.employeeModel.aggregate([
      { $match: { type: EmployeeType.HUMAN } },
      { $group: { _id: '$departmentId', count: { $sum: 1 } } },
    ]);

    const humans = byType.find(t => t._id === EmployeeType.HUMAN)?.count || 0;
    const agents = 0;

    return {
      total,
      byType,
      byStatus,
      byDepartment,
      humans,
      agents,
    };
  }

  /**
   * 设置AI代理（人类员工可以设置AI代理参加会议）
   */
  async setAIProxy(employeeId: string, agentId: string | null): Promise<Employee | null> {
    const employee = await this.employeeModel.findOne({ id: employeeId }).exec();
    if (!employee) return null;

    if (employee.type !== EmployeeType.HUMAN) {
      throw new ConflictException('Only human employees can set AI proxy');
    }

    if (agentId) {
      const assistantAgent = await this.agentClientService.getAgent(agentId);
      if (!assistantAgent) {
        throw new ConflictException('Exclusive assistant agent does not exist or is unavailable');
      }

      const duplicateAssistant = await this.employeeModel.findOne({
        id: { $ne: employeeId },
        type: EmployeeType.HUMAN,
        $or: [
          { exclusiveAssistantAgentId: agentId },
          { aiProxyAgentId: agentId },
        ],
      }).exec();
      if (duplicateAssistant) {
        throw new ConflictException('This agent is already bound as another human account assistant');
      }
    }

    employee.allowAIProxy = !!agentId;
    employee.aiProxyAgentId = agentId || undefined;
    employee.exclusiveAssistantAgentId = agentId || undefined;
    employee.updatedAt = new Date();

    await employee.save();
    this.logger.log(`Set AI proxy for employee ${employeeId}: ${agentId}`);

    return employee;
  }

  async setExclusiveAssistant(employeeId: string, agentId: string): Promise<Employee | null> {
    const employee = await this.employeeModel.findOne({ id: employeeId }).exec();
    if (!employee) return null;

    if (employee.type !== EmployeeType.HUMAN) {
      throw new ConflictException('Only human employees can bind exclusive assistant');
    }

    const agent = await this.agentClientService.getAgent(agentId);
    if (!agent) {
      throw new ConflictException('Exclusive assistant agent does not exist or is unavailable');
    }

    const conflictBinding = await this.employeeModel.findOne({
      id: { $ne: employeeId },
      type: EmployeeType.HUMAN,
      $or: [
        { exclusiveAssistantAgentId: agentId },
        { aiProxyAgentId: agentId },
      ],
    }).exec();
    if (conflictBinding) {
      throw new ConflictException('This agent is already bound as another human account assistant');
    }

    employee.exclusiveAssistantAgentId = agentId;
    employee.allowAIProxy = true;
    employee.aiProxyAgentId = agentId;
    employee.updatedAt = new Date();
    await employee.save();

    this.logger.log(`Set exclusive assistant for employee ${employeeId}: ${agentId}`);
    return employee;
  }

  async getExclusiveAssistant(employeeId: string): Promise<{ employeeId: string; agentId: string | null } | null> {
    const employee = await this.employeeModel.findOne({ id: employeeId }).exec();
    if (!employee) return null;

    return {
      employeeId,
      agentId: employee.exclusiveAssistantAgentId || employee.aiProxyAgentId || null,
    };
  }

  async createAndBindExclusiveAssistant(employeeId: string): Promise<Employee | null> {
    const employee = await this.employeeModel.findOne({ id: employeeId }).exec();
    if (!employee) return null;

    if (employee.type !== EmployeeType.HUMAN) {
      throw new ConflictException('Only human employees can create exclusive assistant');
    }

    const existingAssistantId = employee.exclusiveAssistantAgentId || employee.aiProxyAgentId;
    if (existingAssistantId) {
      const existingAssistant = await this.agentClientService.getAgent(existingAssistantId);
      if (existingAssistant) {
        employee.exclusiveAssistantAgentId = existingAssistantId;
        employee.aiProxyAgentId = existingAssistantId;
        employee.allowAIProxy = true;
        employee.updatedAt = new Date();
        await employee.save();
        return employee;
      }
    }

    const duplicateAssistant = await this.employeeModel.findOne({
      id: { $ne: employeeId },
      type: EmployeeType.HUMAN,
      $or: [
        { exclusiveAssistantAgentId: existingAssistantId },
        { aiProxyAgentId: existingAssistantId },
      ],
    }).exec();
    if (existingAssistantId && duplicateAssistant) {
      throw new ConflictException('This agent is already bound as another human account assistant');
    }

    const ownerDisplayName = employee.name || employee.email || employee.id;
    const assistantName = await this.buildAssistantName(this.buildAssistantDisplayName(ownerDisplayName));
    const model = this.pickDefaultAssistantModel();
    const assistantRoleId = process.env.DEFAULT_EXCLUSIVE_ASSISTANT_ROLE_ID || 'role-human-exclusive-assistant';

    const createdAssistant = await this.agentClientService.createAgent({
      name: assistantName,
      roleId: assistantRoleId,
      description: `人类成员 ${ownerDisplayName} 的专属助理`,
      model,
      capabilities: ['personal_schedule_management', 'task_followup', 'communication_drafting'],
      systemPrompt: `你是 ${ownerDisplayName} 的专属助理。你在会议中默认保持被动，仅在该人类明确 @ 你时响应。请保持简洁、专业，并优先执行个人事务协调与行动跟进。`,
      isActive: true,
      tools: ['websearch', 'webfetch', 'content_extract'],
      permissions: [],
      personality: {
        workEthic: 90,
        creativity: 70,
        leadership: 55,
        teamwork: 92,
      },
      learningAbility: 85,
    });

    const newAssistantId = String(createdAssistant.id || '');
    if (!newAssistantId) {
      throw new ConflictException('Failed to create exclusive assistant agent');
    }

    const sharedAgentConflict = await this.employeeModel.findOne({
      id: { $ne: employeeId },
      type: EmployeeType.HUMAN,
      $or: [
        { exclusiveAssistantAgentId: newAssistantId },
        { aiProxyAgentId: newAssistantId },
      ],
    }).exec();
    if (sharedAgentConflict) {
      throw new ConflictException('Generated assistant is already bound to another human account, please retry');
    }

    employee.exclusiveAssistantAgentId = newAssistantId;
    employee.aiProxyAgentId = newAssistantId;
    employee.allowAIProxy = true;
    employee.updatedAt = new Date();
    await employee.save();

    this.logger.log(`Auto created and bound exclusive assistant for employee ${employeeId}: ${newAssistantId}`);
    return employee;
  }

  /**
   * 获取员工的会议实体ID（用于参加会议）
   */
  async getMeetingEntityId(employeeId: string): Promise<{ type: EmployeeType; id: string; name: string } | null> {
    const employee = await this.employeeModel.findOne({ id: employeeId }).exec();
    if (!employee) return null;

    if (employee.type !== EmployeeType.HUMAN) {
      return null;
    }

    // 如果允许AI代理且设置了代理Agent，使用Agent ID
    if (employee.allowAIProxy && employee.aiProxyAgentId) {
      const agent = await this.agentClientService.getAgent(employee.aiProxyAgentId);
      return {
        type: EmployeeType.AGENT,
        id: employee.aiProxyAgentId,
        name: agent?.name || employee.name || 'AI Proxy',
      };
    }

    // 否则使用人类员工ID
    return {
      type: EmployeeType.HUMAN,
      id: employeeId,
      name: employee.name || 'Unknown',
    };
  }

  /**
   * 获取默认职位名称
   */
  private getDefaultTitle(role: EmployeeRole): string {
    const titles: Record<EmployeeRole, string> = {
      [EmployeeRole.FOUNDER]: '创始人',
      [EmployeeRole.CO_FOUNDER]: '联合创始人',
      [EmployeeRole.CEO]: '首席执行官',
      [EmployeeRole.CTO]: '首席技术官',
      [EmployeeRole.MANAGER]: '经理',
      [EmployeeRole.SENIOR]: '高级工程师',
      [EmployeeRole.JUNIOR]: '工程师',
      [EmployeeRole.INTERN]: '实习生',
    };
    return titles[role] || '员工';
  }

  private resolveEmployeeTierOrThrow(requestedTier: unknown, role: EmployeeRole): AgentRoleTier {
    const normalizedRequestedTier = normalizeAgentRoleTier(requestedTier);
    if (requestedTier !== undefined && !normalizedRequestedTier) {
      throw new ConflictException('tier must be one of leadership, operations, temporary');
    }
    const mappedTier = getTierByEmployeeRole(role);
    if (normalizedRequestedTier && normalizedRequestedTier !== mappedTier) {
      throw new ConflictException(`tier mismatch for role ${role}: expected ${mappedTier}, got ${normalizedRequestedTier}`);
    }
    return normalizedRequestedTier || mappedTier;
  }
}
