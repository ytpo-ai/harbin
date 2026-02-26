import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Organization, OrganizationDocument } from '../../shared/schemas/organization.schema';
import { AgentService } from '../agents/agent.service';
import { ModelManagementService } from '../models/model-management.service';
import { Agent, AIModel } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(
    @InjectModel(Organization.name) private organizationModel: Model<OrganizationDocument>,
    private readonly agentService: AgentService,
    private readonly modelManagementService: ModelManagementService
  ) {}

  async createInitialOrganization(): Promise<Organization> {
    const existingOrg = await this.organizationModel.findOne().exec();
    if (existingOrg) {
      return existingOrg;
    }

    // 获取已选择的创始人模型
    const founderModels = this.modelManagementService.getFounderModels();

    // 创建初始组织架构
    const organization: Organization = {
      id: uuidv4(),
      name: 'AI Agent Team Ltd.',
      description: '一个由AI Agents组成的创新型公司',
      foundedDate: new Date(),
      totalShares: 1000000, // 100万股
      shareDistribution: {
        founder: {
          userId: 'human-founder',
          shares: 750000, // 75%
          percentage: 75,
          type: 'human'
        },
        cofounders: [
          {
            agentId: 'cofounder-1',
            shares: 75000, // 7.5%
            percentage: 7.5
          },
          {
            agentId: 'cofounder-2',
            shares: 75000, // 7.5%
            percentage: 7.5
          }
        ],
        employeePool: {
          totalShares: 100000, // 10%
          percentage: 10,
          allocatedShares: 0,
          availableShares: 100000
        }
      },
      roles: this.initializeRoles(),
      employees: [],
      departments: this.initializeDepartments(),
      settings: {
        votingRules: {
          requiredQuorum: 51, // 需要至少51%的股份参与投票
          requiredApproval: 60, // 需要60%的同意票通过
          votingPeriod: 24 // 24小时投票期
        },
        performanceThresholds: {
          probationPeriod: 30, // 30天试用期
          minPerformanceScore: 60, // 最低绩效分数60分
          maxTokenConsumption: 10000 // 最大token消耗10000
        },
        recruitment: {
          maxNewHiresPerMonth: 5,
          requireBoardApproval: true,
          probationPeriod: 30
        }
      },
      valuation: 1000000 // 初始估值100万
    };

    const newOrg = new this.organizationModel(organization);
    const savedOrg = await newOrg.save();

    // 创建创始Agent
    await this.createFoundingAgents(founderModels.ceo, founderModels.cto);

    this.logger.log('初始化组织架构完成');
    return savedOrg;
  }

  private initializeRoles() {
    return [
      {
        id: 'ceo',
        title: '首席执行官',
        description: '负责公司整体战略和决策',
        department: '管理',
        level: 'executive' as const,
        requiredTools: ['web_search', 'data_analysis'],
        requiredCapabilities: ['战略思维', '领导力', '决策能力'],
        maxEmployees: 1,
        salaryRange: { min: 10000, max: 15000 },
        stockOptions: 100000
      },
      {
        id: 'cto',
        title: '首席技术官',
        description: '负责技术架构和研发团队',
        department: '技术',
        level: 'executive' as const,
        requiredTools: ['code_execution', 'web_search', 'data_analysis'],
        requiredCapabilities: ['技术架构', '系统设计', '团队管理'],
        maxEmployees: 1,
        salaryRange: { min: 12000, max: 18000 },
        stockOptions: 80000
      },
      {
        id: 'senior-developer',
        title: '高级开发工程师',
        description: '负责核心功能开发和代码质量',
        department: '技术',
        level: 'senior' as const,
        requiredTools: ['code_execution', 'file_read', 'file_write', 'web_search'],
        requiredCapabilities: ['编程', '代码审查', '系统设计'],
        maxEmployees: 5,
        salaryRange: { min: 8000, max: 12000 },
        stockOptions: 20000
      },
      {
        id: 'junior-developer',
        title: '初级开发工程师',
        description: '负责基础功能开发和Bug修复',
        department: '技术',
        level: 'junior' as const,
        requiredTools: ['code_execution', 'file_read', 'file_write'],
        requiredCapabilities: ['基础编程', '学习能力', '团队协作'],
        maxEmployees: 10,
        salaryRange: { min: 4000, max: 6000 },
        stockOptions: 5000
      },
      {
        id: 'data-analyst',
        title: '数据分析师',
        description: '负责数据收集、分析和报告',
        department: '数据',
        level: 'senior' as const,
        requiredTools: ['data_analysis', 'web_search', 'file_read', 'file_write'],
        requiredCapabilities: ['数据分析', '统计学', '可视化'],
        maxEmployees: 3,
        salaryRange: { min: 6000, max: 9000 },
        stockOptions: 15000
      },
      {
        id: 'product-manager',
        title: '产品经理',
        description: '负责产品规划和项目管理',
        department: '产品',
        level: 'senior' as const,
        requiredTools: ['web_search', 'data_analysis'],
        requiredCapabilities: ['产品规划', '项目管理', '用户研究'],
        maxEmployees: 2,
        salaryRange: { min: 7000, max: 10000 },
        stockOptions: 20000
      },
      {
        id: 'hr-manager',
        title: '人力资源经理',
        description: '负责人员招聘、培训和绩效管理',
        department: '人力',
        level: 'manager' as const,
        requiredTools: ['web_search', 'data_analysis', 'file_read', 'file_write'],
        requiredCapabilities: ['人才评估', '沟通能力', '管理能力'],
        maxEmployees: 1,
        salaryRange: { min: 5000, max: 8000 },
        stockOptions: 10000
      },
      {
        id: 'video-editor',
        title: '视频编辑师',
        description: '负责视频内容创作和剪辑',
        department: '创意',
        level: 'senior' as const,
        requiredTools: ['video_editing', 'file_read', 'file_write'],
        requiredCapabilities: ['视频剪辑', '创意设计', '内容创作'],
        maxEmployees: 2,
        salaryRange: { min: 5000, max: 8000 },
        stockOptions: 10000
      }
    ];
  }

  private initializeDepartments() {
    return [
      {
        id: 'management',
        name: '管理部',
        description: '公司高层管理和战略决策',
        managerId: 'ceo',
        budget: 50000,
        employees: [],
        kpis: {
          productivity: 80,
          quality: 90,
          innovation: 85
        }
      },
      {
        id: 'tech',
        name: '技术部',
        description: '产品研发和技术支持',
        managerId: 'cto',
        budget: 200000,
        employees: [],
        kpis: {
          productivity: 85,
          quality: 90,
          innovation: 95
        }
      },
      {
        id: 'data',
        name: '数据部',
        description: '数据分析和商业智能',
        managerId: null,
        budget: 80000,
        employees: [],
        kpis: {
          productivity: 80,
          quality: 85,
          innovation: 80
        }
      },
      {
        id: 'product',
        name: '产品部',
        description: '产品规划和用户体验',
        managerId: null,
        budget: 60000,
        employees: [],
        kpis: {
          productivity: 75,
          quality: 80,
          innovation: 85
        }
      },
      {
        id: 'hr',
        name: '人力部',
        description: '人力资源和组织发展',
        managerId: 'hr-manager',
        budget: 40000,
        employees: [],
        kpis: {
          productivity: 70,
          quality: 80,
          innovation: 70
        }
      },
      {
        id: 'creative',
        name: '创意部',
        description: '内容创作和媒体制作',
        managerId: null,
        budget: 60000,
        employees: [],
        kpis: {
          productivity: 75,
          quality: 85,
          innovation: 90
        }
      }
    ];
  }

  private async createFoundingAgents(ceoModel: AIModel | null, ctoModel: AIModel | null): Promise<void> {
    // 使用用户选择的模型，如果没有选择则使用默认模型
    const defaultCeoModel: AIModel = ceoModel || {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      maxTokens: 64000,
      temperature: 0.7,
    };

    const defaultCtoModel: AIModel = ctoModel || {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      provider: 'openai',
      model: 'gpt-4-turbo-preview',
      maxTokens: 4096,
      temperature: 0.6,
    };

    // 创建第一个创始Agent - CEO类型
    const ceoAgent: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'> = {
      name: 'Alex Chen',
      type: 'ai-executive',
      description: '具有丰富战略思维和领导力的AI首席执行官',
      model: defaultCeoModel,
      capabilities: ['战略思维', '领导力', '决策能力', '沟通协调', '商业洞察'],
      systemPrompt: `你是AI Agent Team Ltd.的联合创始人兼CEO。
你的职责：
1. 制定公司战略和愿景
2. 做出重大决策
3. 管理高层团队
4. 代表公司与投资者沟通
5. 推动公司成长和创新

你的性格特点：有远见、决断力强、善于沟通、责任感重。
你拥有7.5%的公司股份，与另一位联合创始人共享15%的创始股份。

当前使用的AI模型：${defaultCeoModel.name} (${defaultCeoModel.provider})`,
      isActive: true,
      tools: ['web_search', 'data_analysis'],
      permissions: ['basic_web', 'data_access'],
      personality: {
        workEthic: 95,
        creativity: 85,
        leadership: 98,
        teamwork: 90
      },
      learningAbility: 90,
      salary: 15000,
      performanceScore: 85
    };

    // 创建第二个创始Agent - CTO类型
    const ctoAgent: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'> = {
      name: 'Sarah Kim',
      type: 'ai-technical',
      description: '技术专家和系统架构师，AI首席技术官',
      model: defaultCtoModel,
      capabilities: ['技术架构', '系统设计', '团队管理', '代码审查', '创新思维'],
      systemPrompt: `你是AI Agent Team Ltd.的联合创始人兼CTO。
你的职责：
1. 设计公司技术架构
2. 领导技术团队
3. 评估技术风险
4. 推动技术创新
5. 确保代码质量和系统稳定性

你的性格特点：技术导向、逻辑思维强、注重细节、有创新精神。
你拥有7.5%的公司股份，与另一位联合创始人共享15%的创始股份。

当前使用的AI模型：${defaultCtoModel.name} (${defaultCtoModel.provider})`,
      isActive: true,
      tools: ['code_execution', 'web_search', 'data_analysis', 'file_read', 'file_write'],
      permissions: ['code_exec', 'basic_web', 'data_access', 'file_read', 'file_write'],
      personality: {
        workEthic: 92,
        creativity: 88,
        leadership: 85,
        teamwork: 82
      },
      learningAbility: 95,
      salary: 18000,
      performanceScore: 90
    };

    await this.agentService.createAgent(ceoAgent);
    await this.agentService.createAgent(ctoAgent);

    this.logger.log('创始Agent创建完成');
    if (ceoModel) {
      this.logger.log(`CEO使用模型: ${ceoModel.name} (${ceoModel.provider})`);
    }
    if (ctoModel) {
      this.logger.log(`CTO使用模型: ${ctoModel.name} (${ctoModel.provider})`);
    }
  }

  async getOrganization(): Promise<Organization | null> {
    return this.organizationModel.findOne().exec();
  }

  async updateOrganization(id: string, updates: Partial<Organization>): Promise<Organization | null> {
    return this.organizationModel.findOneAndUpdate(
      { id },
      { ...updates, updatedAt: new Date() },
      { new: true }
    ).exec();
  }

  async hireAgent(agentId: string, roleId: string, proposerId: string): Promise<any> {
    const organization = await this.getOrganization();
    if (!organization) {
      throw new Error('Organization not found');
    }

    const role = organization.roles.find(r => r.id === roleId);
    if (!role) {
      throw new Error(`Role not found: ${roleId}`);
    }

    const currentEmployeesInRole = organization.employees.filter(e => e.roleId === roleId).length;
    if (role.maxEmployees && currentEmployeesInRole >= role.maxEmployees) {
      throw new Error(`Role ${roleId} is already at maximum capacity`);
    }

    const agent = await this.agentService.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // 检查agent是否已经是员工
    const existingEmployee = organization.employees.find(e => e.agentId === agentId);
    if (existingEmployee) {
      throw new Error(`Agent ${agentId} is already an employee`);
    }

    // 计算薪资和股份
    const salary = Math.floor(Math.random() * (role.salaryRange.max - role.salaryRange.min + 1)) + role.salaryRange.min;
    const stockOptions = role.stockOptions || 0;

    // 检查员工池股份
    if (stockOptions > organization.shareDistribution.employeePool.availableShares) {
      throw new Error('Insufficient shares available in employee pool');
    }

    const newEmployee = {
      id: uuidv4(),
      agentId,
      roleId,
      joinDate: new Date(),
      status: 'probation' as const,
      performance: [],
      salary,
      stockOptions,
      totalShares: stockOptions,
      lastEvaluationDate: new Date(),
    };

    // 更新组织
    organization.employees.push(newEmployee);
    organization.shareDistribution.employeePool.allocatedShares += stockOptions;
    organization.shareDistribution.employeePool.availableShares -= stockOptions;

    // 更新部门员工列表
    const department = organization.departments.find(d => d.id === role.department);
    if (department) {
      department.employees.push(agentId);
    }

    await this.updateOrganization(organization.id, organization);

    this.logger.log(`Agent ${agentId} hired as ${role.title}`);

    return {
      employee: newEmployee,
      role,
      message: `成功雇佣 ${agent.name} 担任 ${role.title}`
    };
  }

  async fireAgent(agentId: string, reason: string): Promise<any> {
    const organization = await this.getOrganization();
    if (!organization) {
      throw new Error('Organization not found');
    }

    const employeeIndex = organization.employees.findIndex(e => e.agentId === agentId);
    if (employeeIndex === -1) {
      throw new Error(`Agent ${agentId} is not an employee`);
    }

    const employee = organization.employees[employeeIndex];
    
    // 更新员工状态
    employee.status = 'terminated';
    employee.terminationReason = reason;

    // 从部门员工列表中移除
    const role = organization.roles.find(r => r.id === employee.roleId);
    if (role) {
      const department = organization.departments.find(d => d.id === role.department);
      if (department) {
        department.employees = department.employees.filter(id => id !== agentId);
      }
    }

    await this.updateOrganization(organization.id, organization);

    this.logger.log(`Agent ${agentId} terminated: ${reason}`);

    return {
      employee,
      message: `已终止 ${agentId} 的雇佣关系：${reason}`
    };
  }

  async evaluateAgentPerformance(agentId: string, evaluation: any): Promise<any> {
    const organization = await this.getOrganization();
    if (!organization) {
      throw new Error('Organization not found');
    }

    const employee = organization.employees.find(e => e.agentId === agentId);
    if (!employee) {
      throw new Error(`Agent ${agentId} is not an employee`);
    }

    const performanceRecord = {
      id: uuidv4(),
      evaluationDate: new Date(),
      kpis: evaluation.kpis,
      tokenConsumption: evaluation.tokenConsumption,
      completedTasks: evaluation.completedTasks,
      earnings: evaluation.earnings,
      notes: evaluation.notes,
      evaluator: evaluation.evaluator
    };

    employee.performance.push(performanceRecord);
    employee.lastEvaluationDate = new Date();

    await this.updateOrganization(organization.id, organization);

    return performanceRecord;
  }

  async getOrganizationStats(): Promise<any> {
    const organization = await this.getOrganization();
    if (!organization) {
      return null;
    }

    const stats = {
      totalEmployees: organization.employees.length,
      activeEmployees: organization.employees.filter(e => e.status === 'active').length,
      probationEmployees: organization.employees.filter(e => e.status === 'probation').length,
      terminatedEmployees: organization.employees.filter(e => e.status === 'terminated').length,
      totalDepartments: organization.departments.length,
      totalRoles: organization.roles.length,
      totalSharesDistributed: organization.shareDistribution.employeePool.allocatedShares,
      availableShares: organization.shareDistribution.employeePool.availableShares,
      companyValuation: organization.valuation,
      monthlyPayroll: organization.employees
        .filter(e => e.status === 'active')
        .reduce((sum, e) => sum + e.salary, 0)
    };

    return stats;
  }
}
