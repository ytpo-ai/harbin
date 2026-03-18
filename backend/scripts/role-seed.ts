import { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentRole, AgentRoleDocument } from '../src/shared/schemas/agent-role.schema';

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

export async function seedAgentRoles(
  app: INestApplicationContext,
): Promise<{ seedCount: number; created: number; updated: number; createdRoleIds: string[]; updatedRoleIds: string[] }> {
  const agentRoleModel = app.get<Model<AgentRoleDocument>>(getModelToken(AgentRole.name));

  const existingRoles = await agentRoleModel.find({}).exec();
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
      const created = await agentRoleModel.create({
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

  return {
    seedCount: AGENT_TYPE_ROLE_SEEDS.length,
    created: createdRoleIds.length,
    updated: updatedRoleIds.length,
    createdRoleIds,
    updatedRoleIds,
  };
}
