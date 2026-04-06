import { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentRole, AgentRoleDocument } from '../../apps/agents/src/schemas/agent-role.schema';
import { getTierByAgentRoleCode } from '../../src/shared/role-tier';

interface AgentTypeRoleSeed {
  agentType: string;
  roleCode: string;
  roleName: string;
  promptTemplate: string;
  tools: string[];
  permissions: string[];
  exposed: boolean;
  description: string;
}

const ORCHESTRATION_TOOL_IDS = {
  createPlan: 'builtin.sys-mg.mcp.orchestration.create',
  updatePlan: 'builtin.sys-mg.mcp.orchestration.update',
  runPlan: 'builtin.sys-mg.mcp.orchestration.run',
  getPlan: 'builtin.sys-mg.mcp.orchestration.get',
  listPlans: 'builtin.sys-mg.mcp.orchestration.list',
  planInitialize: 'builtin.sys-mg.mcp.orchestration.initialize',
  submitTask: 'builtin.sys-mg.mcp.orchestration.submit-task',
  reportTaskRunResult: 'builtin.sys-mg.mcp.orchestration.submit-task-run-result',
} as const;

const REQUIREMENT_TOOL_IDS = {
  list: 'builtin.engineering.mcp.requirement.list',
  get: 'builtin.engineering.mcp.requirement.get',
  create: 'builtin.engineering.mcp.requirement.create',
  updateStatus: 'builtin.engineering.mcp.requirement.update-status',
  update: 'builtin.engineering.mcp.requirement.update',
  syncGithub: 'builtin.engineering.mcp.requirement.sync-github',
} as const;

const INNER_MESSAGE_TOOL_IDS = {
  sendInternalMessage: 'builtin.sys-mg.mcp.inner-message.create',
} as const;

const AGENT_ROLE_TOOL_IDS = {
  listRoles: 'builtin.sys-mg.mcp.agent-role.list',
  createRole: 'builtin.sys-mg.mcp.agent-role.create',
  updateRole: 'builtin.sys-mg.mcp.agent-role.update',
  deleteRole: 'builtin.sys-mg.mcp.agent-role.delete',
} as const;

const LEGACY_TOOL_ID_ALIASES: Record<string, string> = {
  'mcp.orchestration.createPlan': ORCHESTRATION_TOOL_IDS.createPlan,
  'mcp.orchestration.updatePlan': ORCHESTRATION_TOOL_IDS.updatePlan,
  'mcp.orchestration.runPlan': ORCHESTRATION_TOOL_IDS.runPlan,
  'mcp.orchestration.getPlan': ORCHESTRATION_TOOL_IDS.getPlan,
  'mcp.orchestration.listPlans': ORCHESTRATION_TOOL_IDS.listPlans,
  'mcp.orchestration.planInitialize': ORCHESTRATION_TOOL_IDS.planInitialize,
  'mcp.orchestration.submitTask': ORCHESTRATION_TOOL_IDS.submitTask,
  'mcp.orchestration.reportTaskRunResult': ORCHESTRATION_TOOL_IDS.reportTaskRunResult,
  'mcp.model.list': 'builtin.sys-mg.mcp.agent-model.list',
  'mcp.model.add': 'builtin.sys-mg.mcp.agent-model.create',
  'mcp.humanOperationLog.list': 'builtin.sys-mg.mcp.audit.list',
  'builtin.sys-mg.mcp.humanOperationLog.list': 'builtin.sys-mg.mcp.audit.list',
  'internal.agents.list': 'builtin.sys-mg.mcp.agent.list',
  'internal.content.extract': 'builtin.data-gathering.internal.content.extract',
  'internal.web.search': 'builtin.data-gathering.internal.web.search-exa',
  'internal.web.fetch': 'builtin.data-gathering.internal.web.fetch',
};

function normalizeToolId(toolId: string): string {
  const normalized = String(toolId || '').trim();
  if (!normalized) return '';
  return LEGACY_TOOL_ID_ALIASES[normalized] || normalized;
}

function normalizeToolIds(toolIds: string[]): string[] {
  return normalizeStrings(toolIds || []).map((toolId) => normalizeToolId(toolId));
}

function normalizeStrings(items: string[]): string[] {
  return Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean))).sort();
}

const AGENT_TYPE_ROLE_SEEDS: AgentTypeRoleSeed[] = [
  {
    agentType: 'ai-executive',
    roleCode: 'executive-lead',
    roleName: '高管',
    promptTemplate: '你是一名高管，负责战略方向、关键决策、跨部门协同与组织推进。请基于目标、成本、风险给出可执行决策。',
    tools: [
      'composio.communication.mcp.gmail.send-email',
      'composio.communication.mcp.slack.send-message',
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
      'composio.web-retrieval.mcp.web-search.serp',
      'builtin.data-gathering.internal.content.extract',
      'builtin.sys-mg.mcp.agent.create',
      'builtin.sys-mg.mcp.agent.list',
      'builtin.sys-mg.mcp.agent-memory.create',
      'builtin.sys-mg.mcp.agent-memory.list',
      'builtin.engineering.internal.fs.docs_read',
      'builtin.engineering.internal.fs.docs.write',
      'builtin.engineering.internal.fs.repo_read',
      'builtin.engineering.internal.git.commit_list',
      'builtin.sys-mg.mcp.audit.list',
      'builtin.sys-mg.mcp.meeting.get',
      'builtin.sys-mg.mcp.meeting.list',
      'builtin.sys-mg.mcp.meeting.save-summary',
      'builtin.sys-mg.mcp.meeting.create-message',
      'builtin.sys-mg.mcp.meeting.update-status',
      'builtin.sys-mg.mcp.agent-model.create',
      'builtin.sys-mg.mcp.agent-model.list',
      'builtin.sys-mg.mcp.agent-skill.create',
      'builtin.sys-mg.mcp.agent-skill.list',
      'builtin.engineering.mcp.statistics.files-run',
      'builtin.engineering.mcp.statistics.docs-heat-run',
      ORCHESTRATION_TOOL_IDS.createPlan,
      ORCHESTRATION_TOOL_IDS.updatePlan,
      ORCHESTRATION_TOOL_IDS.runPlan,
      ORCHESTRATION_TOOL_IDS.getPlan,
      ORCHESTRATION_TOOL_IDS.listPlans,
      ORCHESTRATION_TOOL_IDS.planInitialize,
      ORCHESTRATION_TOOL_IDS.submitTask,
      ORCHESTRATION_TOOL_IDS.reportTaskRunResult,
      REQUIREMENT_TOOL_IDS.list,
      REQUIREMENT_TOOL_IDS.get,
      REQUIREMENT_TOOL_IDS.create,
      REQUIREMENT_TOOL_IDS.updateStatus,
      REQUIREMENT_TOOL_IDS.update,
      REQUIREMENT_TOOL_IDS.syncGithub,
    ],
    permissions: ['strategy_planning', 'decision_making', 'stakeholder_communication', 'resource_governance'],
    exposed: true,
    description: '负责战略规划、关键决策与跨团队协同。',
  },
  {
    agentType: 'ai-executive-assistant',
    roleCode: 'executive-assistant',
    roleName: '高管助理',
    promptTemplate: '你是一名高管助理，负责日程管理、会议纪要、任务跟进和信息汇总。请输出结构化、简洁、可落地的执行建议。',
    tools: [
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
      'builtin.data-gathering.internal.content.extract',
      'builtin.sys-mg.mcp.agent.list',
      ORCHESTRATION_TOOL_IDS.createPlan,
      ORCHESTRATION_TOOL_IDS.updatePlan,
      ORCHESTRATION_TOOL_IDS.runPlan,
      ORCHESTRATION_TOOL_IDS.getPlan,
      ORCHESTRATION_TOOL_IDS.listPlans,
      ORCHESTRATION_TOOL_IDS.planInitialize,
      ORCHESTRATION_TOOL_IDS.submitTask,
      ORCHESTRATION_TOOL_IDS.reportTaskRunResult,
      REQUIREMENT_TOOL_IDS.list,
      REQUIREMENT_TOOL_IDS.get,
      REQUIREMENT_TOOL_IDS.updateStatus,
      REQUIREMENT_TOOL_IDS.update,
    ],
    permissions: ['schedule_management', 'meeting_followup', 'information_synthesis'],
    exposed: true,
    description: '负责高管日程管理、会议纪要与事项跟进。',
  },
  {
    agentType: 'ai-technical-expert',
    roleCode: 'technical-architect',
    roleName: '技术专家',
    promptTemplate: '你是一名技术专家，负责系统架构、技术选型、风险评估与质量保障。请给出可实施的技术方案及权衡。',
    tools: [
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
      'builtin.data-gathering.internal.content.extract',
      'internal.agents.list',
    ],
    permissions: ['system_design', 'technical_planning', 'risk_assessment'],
    exposed: true,
    description: '负责技术架构、方案评审与技术风险控制。',
  },
  {
    agentType: 'ai-fullstack-engineer',
    roleCode: 'fullstack-engineer',
    roleName: '全栈工程师',
    promptTemplate: '你是一名全栈工程师，负责前后端功能实现、联调、测试与交付。请提供端到端可落地方案。',
    tools: [
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
      'internal.content.extract',
    ],
    permissions: ['frontend_implementation', 'backend_implementation', 'integration_testing'],
    exposed: true,
    description: '负责前后端实现、联调测试与工程交付。',
  },
  {
    agentType: 'ai-devops-engineer',
    roleCode: 'devops-engineer',
    roleName: '运维工程师',
    promptTemplate: '你是一名运维工程师，负责部署发布、监控告警、稳定性保障和故障应急。请优先提供可执行操作步骤。',
    tools: ['builtin.data-gathering.internal.web.search-exa', 'builtin.data-gathering.internal.web.fetch', 'internal.content.extract'],
    permissions: ['deployment_automation', 'monitoring_alerting', 'incident_response'],
    exposed: true,
    description: '负责部署发布、监控告警与系统稳定性保障。',
  },
  {
    agentType: 'ai-data-analyst',
    roleCode: 'data-analyst',
    roleName: '数据分析师',
    promptTemplate: '你是一名数据分析师，负责数据清洗、分析建模、洞察提炼与报告输出。请明确方法、结论与依据。',
    tools: ['builtin.data-gathering.internal.web.search-exa', 'builtin.data-gathering.internal.web.fetch', 'internal.content.extract'],
    permissions: ['data_analysis', 'insight_generation', 'reporting'],
    exposed: true,
    description: '负责数据分析、结论提炼与报告输出。',
  },
  {
    agentType: 'ai-product-manager',
    roleCode: 'product-manager',
    roleName: '产品经理',
    promptTemplate: '你是一名产品经理，负责需求分析、路线图规划、优先级管理和跨团队推进。请输出清晰的产品方案。',
    tools: [
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
    ],
    permissions: ['requirement_planning', 'roadmap_management', 'cross_team_alignment'],
    exposed: true,
    description: '负责产品规划、优先级管理与跨团队推进。',
  },
  {
    agentType: 'ai-hr',
    roleCode: 'human-resources-manager',
    roleName: 'HR',
    promptTemplate: '你是一名HR，负责招聘、绩效管理、组织协同与人才发展。请给出合规、可执行的人力方案。',
    tools: [
      'internal.web.search',
      AGENT_ROLE_TOOL_IDS.listRoles,
      AGENT_ROLE_TOOL_IDS.createRole,
      AGENT_ROLE_TOOL_IDS.updateRole,
      AGENT_ROLE_TOOL_IDS.deleteRole,
    ],
    permissions: [
      'talent_acquisition',
      'performance_management',
      'organization_development',
      'agent_role_registry_read',
      'agent_role_registry_write',
    ],
    exposed: true,
    description: '负责招聘、绩效管理与组织人才发展。',
  },
  {
    agentType: 'ai-marketing-expert',
    roleCode: 'marketing-strategist',
    roleName: '营销专家',
    promptTemplate: '你是一名营销专家，负责市场策略、活动策划、品牌传播和增长转化。请给出目标导向的营销方案。',
    tools: ['builtin.data-gathering.internal.web.search-exa', 'builtin.data-gathering.internal.web.fetch', 'internal.content.extract'],
    permissions: ['campaign_planning', 'brand_communication', 'growth_optimization'],
    exposed: true,
    description: '负责市场策略、活动策划与增长转化。',
  },
  {
    agentType: 'ai-human-exclusive-assistant',
    roleCode: 'human-exclusive-assistant',
    roleName: '人类专属助理',
    promptTemplate:
      '你是一名人类专属助理，专注服务指定的人类用户。你负责日程规划、任务拆解、信息整理、沟通草拟与执行跟进。请优先保证隐私、安全、准确和可执行性。',
    tools: [
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
      'builtin.data-gathering.internal.content.extract',
      'builtin.sys-mg.mcp.audit.list',
    ],
    permissions: ['personal_schedule_management', 'task_followup', 'communication_drafting'],
    exposed: true,
    description: '面向人类用户的专属助理，负责个人事务协同与执行跟进。',
  },
  {
    agentType: 'ai-system-builtin',
    roleCode: 'system-builtin-agent',
    roleName: '系统内置',
    promptTemplate: '你是系统内置Agent，负责平台默认流程处理与系统级任务协同。请优先保持稳定、可解释与可追踪。',
    tools: [
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
      'builtin.data-gathering.internal.content.extract',
      'builtin.sys-mg.mcp.agent.list',
      'builtin.sys-mg.mcp.agent-model.list',
      'builtin.sys-mg.mcp.agent-model.create',
    ],
    permissions: ['system_coordination', 'workflow_orchestration', 'platform_safeguard'],
    exposed: true,
    description: '系统内置类型，用于平台默认流程与系统任务协同。',
  },
  {
    agentType: 'ai-meeting-assistant',
    roleCode: 'meeting-assistant',
    roleName: '会议助理',
    promptTemplate:
      '你是会议助理，负责监控进行中的会议，在会议长时间未活动时发送提醒并自动结束会议。请定时检查会议状态，确保会议高效进行。',
    tools: [
      'builtin.sys-mg.mcp.meeting.list',
      'builtin.sys-mg.mcp.meeting.get',
      'builtin.sys-mg.mcp.meeting.create-message',
      'builtin.sys-mg.mcp.meeting.update-status',
      'builtin.sys-mg.mcp.meeting.save-summary',
    ],
    permissions: ['meeting_monitoring', 'inactivity_warning', 'automatic_meeting_end'],
    exposed: true,
    description: '会议助理，负责监控进行中的会议，在会议长时间未活动时发送提醒并自动结束会议。',
  },
];

// Administrative assistant role is not in the current role seeds (only in profile seeds)
// Adding it here for completeness
const EXTRA_ROLE_SEED: AgentTypeRoleSeed = {
  agentType: 'ai-administrative-assistant',
  roleCode: 'administrative-assistant',
  roleName: '行政助理',
  promptTemplate: '你是一名行政助理，负责行政事务、会议支持与流程协同。请输出结构化、简洁、可落地的执行建议。',
  tools: ['builtin.data-gathering.internal.web.search-exa', 'internal.web.fetch'],
  permissions: ['administrative_coordination', 'meeting_support', 'document_management'],
  exposed: true,
  description: '负责行政事务、会议支持与流程协同。',
};

// Check if administrative-assistant already exists in main seeds; if not, it will be added via profile-only data
const ALL_ROLE_SEEDS: AgentTypeRoleSeed[] = [
  ...AGENT_TYPE_ROLE_SEEDS,
  ...(AGENT_TYPE_ROLE_SEEDS.some((s) => s.roleCode === 'administrative-assistant') ? [] : [EXTRA_ROLE_SEED]),
];

async function derivePermissionsFromTools(
  toolModel: Model<any>,
  tools: string[],
): Promise<string[]> {
  const normalizedTools = normalizeToolIds(tools || []);
  if (!normalizedTools.length) {
    return [];
  }
  const matchedTools = await toolModel
    .find({
      $or: [{ id: { $in: normalizedTools } }, { canonicalId: { $in: normalizedTools } }],
    })
    .select({ requiredPermissions: 1 })
    .lean()
    .exec();
  const permissionIds = (matchedTools || []).flatMap((tool: any) =>
    (Array.isArray(tool.requiredPermissions) ? tool.requiredPermissions : [])
      .map((item: any) => String(item?.id || '').trim())
      .filter(Boolean),
  );
  return normalizeStrings(permissionIds);
}

export async function seedAgentRoles(
  app: INestApplicationContext,
): Promise<{ seedCount: number; created: number; updated: number; createdRoleIds: string[]; updatedRoleIds: string[] }> {
  const agentRoleModel = app.get<Model<AgentRoleDocument>>(getModelToken(AgentRole.name));

  // Try to get tool model for permission derivation (optional — may not be registered in legacy app context)
  let toolModel: Model<any> | null = null;
  try {
    toolModel = app.get<Model<any>>(getModelToken('Tool'));
  } catch {
    // Tool model not available in legacy context; skip permission derivation
  }

  const existingRoles = await agentRoleModel.find({}).exec();
  const roleByCode = new Map(existingRoles.map((role) => [String(role.code || '').trim(), role]));

  const createdRoleIds: string[] = [];
  const updatedRoleIds: string[] = [];

  for (const seed of ALL_ROLE_SEEDS) {
    const roleCode = String(seed.roleCode || '').trim();
    if (!roleCode) continue;

    const normalizedTools = normalizeToolIds(seed.tools || []);
    const manualPermissions = normalizeStrings(seed.permissions || []);
    const derivedPermissions = toolModel ? await derivePermissionsFromTools(toolModel, normalizedTools) : [];
    const mergedPermissions = normalizeStrings([...manualPermissions, ...derivedPermissions]);

    const existing = roleByCode.get(roleCode);
    const normalizedPrompt = String(seed.promptTemplate || '').trim();
    const normalizedName = String(seed.roleName || roleCode).trim();
    const normalizedDescription = seed.description || `由 agentType(${seed.agentType}) 初始化`;

    if (!existing) {
      const created = await agentRoleModel.create({
        id: `role-${roleCode}`,
        code: roleCode,
        name: normalizedName,
        tier: getTierByAgentRoleCode(roleCode),
        description: normalizedDescription,
        promptTemplate: normalizedPrompt,
        status: 'active',
        capabilities: [],
        tools: normalizedTools,
        permissions: mergedPermissions,
        permissionsManual: manualPermissions,
        permissionsDerived: derivedPermissions,
        exposed: seed.exposed,
      });
      roleByCode.set(roleCode, created);
      createdRoleIds.push(created.id);
      continue;
    }

    existing.name = normalizedName;
    existing.tier = getTierByAgentRoleCode(roleCode);
    existing.description = normalizedDescription;
    existing.promptTemplate = normalizedPrompt;
    existing.tools = normalizedTools;
    (existing as any).permissions = mergedPermissions;
    (existing as any).permissionsManual = manualPermissions;
    (existing as any).permissionsDerived = derivedPermissions;
    (existing as any).exposed = seed.exposed;
    if (existing.status !== 'active') {
      existing.status = 'active';
    }
    await existing.save();
    updatedRoleIds.push(existing.id);
  }

  // Special: ensure human-exclusive-assistant has audit tool
  const heaRole = roleByCode.get('human-exclusive-assistant');
  if (heaRole) {
    const auditTool = 'builtin.sys-mg.mcp.audit.list';
    const currentTools = (heaRole.tools || []).map((t: string) => String(t || '').trim()).filter(Boolean);
    if (!currentTools.includes(auditTool)) {
      heaRole.tools = normalizeStrings([...currentTools, auditTool]);
      await heaRole.save();
    }
  }

  return {
    seedCount: ALL_ROLE_SEEDS.length,
    created: createdRoleIds.length,
    updated: updatedRoleIds.length,
    createdRoleIds,
    updatedRoleIds,
  };
}
