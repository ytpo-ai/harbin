import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentRole, AgentRoleDocument, AgentRoleStatus } from '../../shared/schemas/agent-role.schema';
import { Agent, AgentDocument } from '../../shared/schemas/agent.schema';

interface AgentTypeRoleSeed {
  agentType: string;
  roleCode: string;
  roleName: string;
  promptTemplate: string;
}

const AGENT_TYPE_ROLE_SEEDS: AgentTypeRoleSeed[] = [
  { agentType: 'ai-executive', roleCode: 'executive-lead', roleName: '高管', promptTemplate: '你是一名高管，负责战略方向、关键决策、跨部门协同与组织推进。请基于目标、成本、风险给出可执行决策。' },
  { agentType: 'ai-management-assistant', roleCode: 'management-assistant', roleName: '高管助理', promptTemplate: '你是一名高管助理，负责日程管理、会议纪要、任务跟进和信息汇总。请输出结构化、简洁、可落地的执行建议。' },
  { agentType: 'ai-technical-expert', roleCode: 'technical-architect', roleName: '技术专家', promptTemplate: '你是一名技术专家，负责系统架构、技术选型、风险评估与质量保障。请给出可实施的技术方案及权衡。' },
  { agentType: 'ai-fullstack-engineer', roleCode: 'fullstack-engineer', roleName: '全栈工程师', promptTemplate: '你是一名全栈工程师，负责前后端功能实现、联调、测试与交付。请提供端到端可落地方案。' },
  { agentType: 'ai-devops-engineer', roleCode: 'devops-engineer', roleName: '运维工程师', promptTemplate: '你是一名运维工程师，负责部署发布、监控告警、稳定性保障和故障应急。请优先提供可执行操作步骤。' },
  { agentType: 'ai-data-analyst', roleCode: 'data-analyst', roleName: '数据分析师', promptTemplate: '你是一名数据分析师，负责数据清洗、分析建模、洞察提炼与报告输出。请明确方法、结论与依据。' },
  { agentType: 'ai-product-manager', roleCode: 'product-manager', roleName: '产品经理', promptTemplate: '你是一名产品经理，负责需求分析、路线图规划、优先级管理和跨团队推进。请输出清晰的产品方案。' },
  { agentType: 'ai-hr', roleCode: 'human-resources-manager', roleName: 'HR', promptTemplate: '你是一名HR，负责招聘、绩效管理、组织协同与人才发展。请给出合规、可执行的人力方案。' },
  { agentType: 'ai-admin-assistant', roleCode: 'administrative-assistant', roleName: '行政助理', promptTemplate: '你是一名行政助理，负责行政流程、会议支持、文档协调和日常运营保障。请输出可执行清单。' },
  { agentType: 'ai-marketing-expert', roleCode: 'marketing-strategist', roleName: '营销专家', promptTemplate: '你是一名营销专家，负责市场策略、活动策划、品牌传播和增长转化。请给出目标导向的营销方案。' },
  {
    agentType: 'ai-human-exclusive-assistant',
    roleCode: 'human-exclusive-assistant',
    roleName: '人类专属助理',
    promptTemplate:
      '你是一名人类专属助理，专注服务指定的人类用户。你负责日程规划、任务拆解、信息整理、沟通草拟与执行跟进。请优先保证隐私、安全、准确和可执行性。',
  },
  { agentType: 'ai-system-builtin', roleCode: 'system-builtin-agent', roleName: '系统内置', promptTemplate: '你是系统内置Agent，负责平台默认流程处理与系统级任务协同。请优先保持稳定、可解释与可追踪。' },
  {
    agentType: 'ai-meeting-assistant',
    roleCode: 'meeting-assistant',
    roleName: '会议助理',
    promptTemplate:
      '你是会议助理，负责监控进行中的会议，在会议长时间未活动时发送提醒并自动结束会议。请定时检查会议状态，确保会议高效进行。',
  },
];

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(AgentRole.name) private readonly agentRoleModel: Model<AgentRoleDocument>,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
  ) {}

  async getRoles(query?: { status?: AgentRoleStatus }): Promise<AgentRole[]> {
    const filter: Record<string, unknown> = {};
    if (query?.status === 'active' || query?.status === 'inactive') {
      filter.status = query.status;
    }
    return this.agentRoleModel.find(filter).sort({ updatedAt: -1 }).exec();
  }

  async getRoleById(id: string): Promise<AgentRole> {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      throw new BadRequestException('Role id is required');
    }

    const role = await this.agentRoleModel.findOne({ id: normalizedId }).exec();
    if (!role) {
      throw new NotFoundException(`Role not found: ${normalizedId}`);
    }
    return role;
  }

  async createRole(input: {
    code: string;
    name: string;
    description?: string;
    capabilities?: string[];
    tools?: string[];
    promptTemplate?: string;
    status?: AgentRoleStatus;
  }): Promise<AgentRole> {
    const code = String(input?.code || '').trim();
    const name = String(input?.name || '').trim();
    if (!code) {
      throw new BadRequestException('Role code is required');
    }
    if (!name) {
      throw new BadRequestException('Role name is required');
    }

    const existing = await this.agentRoleModel.findOne({ code }).exec();
    if (existing) {
      throw new BadRequestException(`Role code already exists: ${code}`);
    }

    const role = new this.agentRoleModel({
      code,
      name,
      description: String(input?.description || '').trim(),
      capabilities: Array.isArray(input?.capabilities)
        ? input.capabilities.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      tools: Array.isArray(input?.tools)
        ? input.tools.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      promptTemplate: String(input?.promptTemplate || '').trim(),
      status: input?.status === 'inactive' ? 'inactive' : 'active',
    });

    return role.save();
  }

  async updateRole(
    id: string,
    updates: {
      code?: string;
      name?: string;
      description?: string;
      capabilities?: string[];
      tools?: string[];
      promptTemplate?: string;
      status?: AgentRoleStatus;
    },
  ): Promise<AgentRole> {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      throw new BadRequestException('Role id is required');
    }

    const role = await this.agentRoleModel.findOne({ id: normalizedId }).exec();
    if (!role) {
      throw new NotFoundException(`Role not found: ${normalizedId}`);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'code')) {
      const nextCode = String(updates.code || '').trim();
      if (!nextCode) {
        throw new BadRequestException('Role code cannot be empty');
      }
      const duplicate = await this.agentRoleModel.findOne({ code: nextCode, id: { $ne: normalizedId } }).exec();
      if (duplicate) {
        throw new BadRequestException(`Role code already exists: ${nextCode}`);
      }
      role.code = nextCode;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
      const nextName = String(updates.name || '').trim();
      if (!nextName) {
        throw new BadRequestException('Role name cannot be empty');
      }
      role.name = nextName;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
      role.description = String(updates.description || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'capabilities')) {
      role.capabilities = Array.isArray(updates.capabilities)
        ? updates.capabilities.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'tools')) {
      role.tools = Array.isArray(updates.tools)
        ? updates.tools.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'promptTemplate')) {
      role.promptTemplate = String(updates.promptTemplate || '').trim();
    }

    if (updates.status === 'active' || updates.status === 'inactive') {
      role.status = updates.status;
    }

    return role.save();
  }

  async deleteRole(id: string): Promise<{ deleted: boolean }> {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) {
      throw new BadRequestException('Role id is required');
    }
    const result = await this.agentRoleModel.deleteOne({ id: normalizedId }).exec();
    return { deleted: result.deletedCount === 1 };
  }

  async syncRolesFromAgentTypes(options?: { backfillAgents?: boolean }) {
    const existingRoles = await this.agentRoleModel.find({}).exec();
    const roleByCode = new Map(existingRoles.map((role) => [String(role.code || '').trim(), role]));

    const createdRoleIds: string[] = [];
    const updatedRoleIds: string[] = [];

    for (const seed of AGENT_TYPE_ROLE_SEEDS) {
      const roleCode = String(seed.roleCode || '').trim();
      if (!roleCode) continue;

      const existing = roleByCode.get(roleCode);
      const normalizedPrompt = String(seed.promptTemplate || '').trim();
      const normalizedName = String(seed.roleName || roleCode).trim();
      const normalizedDescription = `由 agentType(${seed.agentType}) 初始化`;

      if (!existing) {
        const created = await this.agentRoleModel.create({
          id: `role-${roleCode}`,
          code: roleCode,
          name: normalizedName,
          description: normalizedDescription,
          promptTemplate: normalizedPrompt,
          status: 'active',
          capabilities: [],
          tools: [],
        });
        roleByCode.set(roleCode, created);
        createdRoleIds.push(created.id);
        continue;
      }

      existing.name = normalizedName;
      existing.description = normalizedDescription;
      existing.promptTemplate = normalizedPrompt;
      if (existing.status !== 'active') {
        existing.status = 'active';
      }
      await existing.save();
      updatedRoleIds.push(existing.id);
    }

    if (!options?.backfillAgents) {
      return {
        seedCount: AGENT_TYPE_ROLE_SEEDS.length,
        roles: { created: createdRoleIds.length, updated: updatedRoleIds.length, createdRoleIds, updatedRoleIds },
        agents: { scanned: 0, backfilled: 0, alreadyBound: 0, missingMapping: [] as string[], missingRoleForCode: [] as string[] },
      };
    }

    const seedByType = new Map(AGENT_TYPE_ROLE_SEEDS.map((seed) => [seed.agentType, seed]));
    const agents = await this.agentModel.find({}).exec();
    let backfilled = 0;
    let alreadyBound = 0;
    const missingMappingSet = new Set<string>();
    const missingRoleForCodeSet = new Set<string>();

    for (const agent of agents) {
      const agentType = String(agent.type || '').trim();
      const seed = seedByType.get(agentType);
      if (!seed) {
        missingMappingSet.add(agentType || '<empty-type>');
        continue;
      }

      const role = roleByCode.get(seed.roleCode);
      if (!role) {
        missingRoleForCodeSet.add(seed.roleCode);
        continue;
      }

      if (String(agent.roleId || '').trim() === role.id) {
        alreadyBound += 1;
        continue;
      }

      agent.roleId = role.id;
      await agent.save();
      backfilled += 1;
    }

    return {
      seedCount: AGENT_TYPE_ROLE_SEEDS.length,
      roles: { created: createdRoleIds.length, updated: updatedRoleIds.length, createdRoleIds, updatedRoleIds },
      agents: {
        scanned: agents.length,
        backfilled,
        alreadyBound,
        missingMapping: Array.from(missingMappingSet),
        missingRoleForCode: Array.from(missingRoleForCodeSet),
      },
    };
  }
}
