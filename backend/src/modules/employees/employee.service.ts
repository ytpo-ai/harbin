import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Employee, EmployeeDocument, EmployeeType, EmployeeStatus, EmployeeRole } from '../../shared/schemas/employee.schema';
import { Organization, OrganizationDocument } from '../../shared/schemas/organization.schema';
import { AgentClientService } from '../agents-client/agent-client.service';
import { v4 as uuidv4 } from 'uuid';

export interface CreateEmployeeDto {
  type: EmployeeType;
  organizationId: string;
  // 人类员工字段
  userId?: string;
  name?: string;
  email?: string;
  avatar?: string;
  // Agent员工字段
  agentId?: string;
  // 共同字段
  role: EmployeeRole;
  departmentId?: string;
  title?: string;
  description?: string;
  salary?: number;
  shares?: number;
  stockOptions?: number;
  capabilities?: string[];
  allowAIProxy?: boolean;
  aiProxyAgentId?: string;
}

export interface UpdateEmployeeDto {
  name?: string;
  email?: string;
  avatar?: string;
  role?: EmployeeRole;
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
export class EmployeeService {
  private readonly logger = new Logger(EmployeeService.name);

  constructor(
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(Organization.name) private organizationModel: Model<OrganizationDocument>,
    private readonly agentClientService: AgentClientService,
  ) {}

  /**
   * 创建员工（人类或Agent）
   */
  async createEmployee(dto: CreateEmployeeDto): Promise<Employee> {
    // 验证必填字段
    if (dto.type === EmployeeType.HUMAN && !dto.name) {
      throw new ConflictException('Human employee must have a name');
    }
    if (dto.type === EmployeeType.AGENT && !dto.agentId) {
      throw new ConflictException('Agent employee must have an agentId');
    }

    // 检查是否已存在
    if (dto.type === EmployeeType.AGENT && dto.agentId) {
      const existing = await this.employeeModel.findOne({
        organizationId: dto.organizationId,
        agentId: dto.agentId,
      }).exec();
      if (existing) {
        throw new ConflictException('Agent is already an employee in this organization');
      }
    }

    if (dto.type === EmployeeType.HUMAN && dto.userId) {
      const existing = await this.employeeModel.findOne({
        organizationId: dto.organizationId,
        userId: dto.userId,
      }).exec();
      if (existing) {
        throw new ConflictException('User is already an employee in this organization');
      }
    }

    const employee = new this.employeeModel({
      id: uuidv4(),
      organizationId: dto.organizationId,
      type: dto.type,
      userId: dto.userId,
      name: dto.name,
      email: dto.email,
      avatar: dto.avatar,
      agentId: dto.agentId,
      role: dto.role,
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
    this.logger.log(`Created ${dto.type} employee: ${saved.name || saved.agentId} in org ${dto.organizationId}`);

    // 如果是Agent员工，获取Agent信息填充能力
    if (dto.type === EmployeeType.AGENT && dto.agentId) {
      const agent = await this.agentClientService.getAgent(dto.agentId);
      if (agent) {
        saved.capabilities = agent.capabilities || [];
        saved.name = agent.name;
        await saved.save();
      }
    }

    return saved;
  }

  /**
   * 获取组织下的所有员工
   */
  async getEmployeesByOrganization(
    organizationId: string,
    filters?: { type?: EmployeeType; status?: EmployeeStatus; departmentId?: string }
  ): Promise<Employee[]> {
    const query: any = { organizationId };
    if (filters?.type) query.type = filters.type;
    if (filters?.status) query.status = filters.status;
    if (filters?.departmentId) query.departmentId = filters.departmentId;

    return this.employeeModel.find(query).sort({ createdAt: -1 }).exec();
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
  async getEmployeeByAgentId(organizationId: string, agentId: string): Promise<Employee | null> {
    return this.employeeModel.findOne({ organizationId, agentId }).exec();
  }

  /**
   * 通过用户ID获取员工
   */
  async getEmployeeByUserId(organizationId: string, userId: string): Promise<Employee | null> {
    return this.employeeModel.findOne({ organizationId, userId }).exec();
  }

  /**
   * 更新员工信息
   */
  async updateEmployee(employeeId: string, dto: UpdateEmployeeDto): Promise<Employee | null> {
    const updated = await this.employeeModel.findOneAndUpdate(
      { id: employeeId },
      { ...dto, updatedAt: new Date() },
      { new: true }
    ).exec();

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
  async getEmployeeStats(organizationId: string): Promise<EmployeeStats> {
    const total = await this.employeeModel.countDocuments({ organizationId });
    
    const byType = await this.employeeModel.aggregate([
      { $match: { organizationId } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);

    const byStatus = await this.employeeModel.aggregate([
      { $match: { organizationId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const byDepartment = await this.employeeModel.aggregate([
      { $match: { organizationId } },
      { $group: { _id: '$departmentId', count: { $sum: 1 } } },
    ]);

    const humans = byType.find(t => t._id === EmployeeType.HUMAN)?.count || 0;
    const agents = byType.find(t => t._id === EmployeeType.AGENT)?.count || 0;

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

    employee.allowAIProxy = !!agentId;
    employee.aiProxyAgentId = agentId || undefined;
    employee.updatedAt = new Date();

    await employee.save();
    this.logger.log(`Set AI proxy for employee ${employeeId}: ${agentId}`);

    return employee;
  }

  /**
   * 获取员工的会议实体ID（用于参加会议）
   */
  async getMeetingEntityId(employeeId: string): Promise<{ type: EmployeeType; id: string; name: string } | null> {
    const employee = await this.employeeModel.findOne({ id: employeeId }).exec();
    if (!employee) return null;

    if (employee.type === EmployeeType.HUMAN) {
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
    } else {
      // Agent员工直接使用Agent ID
      const agent = await this.agentClientService.getAgent(employee.agentId!);
      return {
        type: EmployeeType.AGENT,
        id: employee.agentId!,
        name: agent?.name || 'Unknown',
      };
    }
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
}
