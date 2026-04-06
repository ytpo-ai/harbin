import mongoose, { Schema } from 'mongoose';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';

type SeedMode = 'sync' | 'append';

type McpProfileSeed = {
  roleCode: string;
  role: string;
  tools: string[];
  permissions?: string[];
  capabilities?: string[];
  exposed: boolean;
  description?: string;
};

type ToolRow = {
  id?: string;
  canonicalId?: string;
  requiredPermissions?: Array<{ id?: string }>;
};

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

const MCP_PROFILE_SEEDS: McpProfileSeed[] = [
  {
    roleCode: 'executive-lead',
    role: 'executive-lead',
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
      INNER_MESSAGE_TOOL_IDS.sendInternalMessage,
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
    roleCode: 'management-assistant',
    role: 'management-assistant',
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
      INNER_MESSAGE_TOOL_IDS.sendInternalMessage,
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
    roleCode: 'technical-architect',
    role: 'technical-architect',
    tools: [
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
      'builtin.data-gathering.internal.content.extract',
      'internal.agents.list',
      INNER_MESSAGE_TOOL_IDS.sendInternalMessage,
    ],
    permissions: ['system_design', 'technical_planning', 'risk_assessment'],
    exposed: true,
    description: '负责技术架构、方案评审与技术风险控制。',
  },
  {
    roleCode: 'fullstack-engineer',
    role: 'fullstack-engineer',
    tools: [
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
      'internal.content.extract',
      INNER_MESSAGE_TOOL_IDS.sendInternalMessage,
    ],
    permissions: ['frontend_implementation', 'backend_implementation', 'integration_testing'],
    exposed: true,
    description: '负责前后端实现、联调测试与工程交付。',
  },
  {
    roleCode: 'devops-engineer',
    role: 'devops-engineer',
    tools: ['builtin.data-gathering.internal.web.search-exa', 'builtin.data-gathering.internal.web.fetch', 'internal.content.extract'],
    permissions: ['deployment_automation', 'monitoring_alerting', 'incident_response'],
    exposed: true,
    description: '负责部署发布、监控告警与系统稳定性保障。',
  },
  {
    roleCode: 'data-analyst',
    role: 'data-analyst',
    tools: ['builtin.data-gathering.internal.web.search-exa', 'builtin.data-gathering.internal.web.fetch', 'internal.content.extract'],
    permissions: ['data_analysis', 'insight_generation', 'reporting'],
    exposed: true,
    description: '负责数据分析、结论提炼与报告输出。',
  },
  {
    roleCode: 'product-manager',
    role: 'product-manager',
    tools: [
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
      ORCHESTRATION_TOOL_IDS.createPlan,
      ORCHESTRATION_TOOL_IDS.updatePlan,
      ORCHESTRATION_TOOL_IDS.runPlan,
      ORCHESTRATION_TOOL_IDS.getPlan,
      ORCHESTRATION_TOOL_IDS.listPlans,
      ORCHESTRATION_TOOL_IDS.submitTask,
      ORCHESTRATION_TOOL_IDS.reportTaskRunResult,
    ],
    permissions: ['requirement_planning', 'roadmap_management', 'cross_team_alignment'],
    exposed: true,
    description: '负责产品规划、优先级管理与跨团队推进。',
  },
  {
    roleCode: 'human-resources-manager',
    role: 'human-resources-manager',
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
    roleCode: 'administrative-assistant',
    role: 'administrative-assistant',
    tools: ['builtin.data-gathering.internal.web.search-exa', 'internal.web.fetch'],
    permissions: ['administrative_coordination', 'meeting_support', 'document_management'],
    exposed: true,
    description: '负责行政事务、会议支持与流程协同。',
  },
  {
    roleCode: 'marketing-strategist',
    role: 'marketing-strategist',
    tools: ['builtin.data-gathering.internal.web.search-exa', 'builtin.data-gathering.internal.web.fetch', 'internal.content.extract'],
    permissions: ['campaign_planning', 'brand_communication', 'growth_optimization'],
    exposed: true,
    description: '负责市场策略、活动策划与增长转化。',
  },
  {
    roleCode: 'human-exclusive-assistant',
    role: 'human-exclusive-assistant',
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
    roleCode: 'system-builtin-agent',
    role: 'system-builtin-agent',
    tools: [
      'builtin.data-gathering.internal.web.search-exa',
      'builtin.data-gathering.internal.web.fetch',
      'builtin.data-gathering.internal.content.extract',
      'builtin.sys-mg.mcp.agent.list',
      'builtin.sys-mg.mcp.agent-model.list',
      'builtin.sys-mg.mcp.agent-model.create',
      ORCHESTRATION_TOOL_IDS.createPlan,
      ORCHESTRATION_TOOL_IDS.runPlan,
      ORCHESTRATION_TOOL_IDS.getPlan,
      ORCHESTRATION_TOOL_IDS.listPlans,
      ORCHESTRATION_TOOL_IDS.submitTask,
      ORCHESTRATION_TOOL_IDS.reportTaskRunResult,
      INNER_MESSAGE_TOOL_IDS.sendInternalMessage,
      REQUIREMENT_TOOL_IDS.list,
      REQUIREMENT_TOOL_IDS.get,
      REQUIREMENT_TOOL_IDS.updateStatus,
      REQUIREMENT_TOOL_IDS.update,
      REQUIREMENT_TOOL_IDS.syncGithub,
    ],
    permissions: ['system_coordination', 'workflow_orchestration', 'platform_safeguard'],
    exposed: true,
    description: '系统内置类型，用于平台默认流程与系统任务协同。',
  },
  {
    roleCode: 'meeting-assistant',
    role: 'meeting-assistant',
    tools: [
      'builtin.sys-mg.mcp.meeting.list',
      'builtin.sys-mg.mcp.meeting.get',
      'builtin.sys-mg.mcp.meeting.create-message',
      'builtin.sys-mg.mcp.meeting.update-status',
      'builtin.sys-mg.mcp.meeting.save-summary',
      INNER_MESSAGE_TOOL_IDS.sendInternalMessage,
    ],
    permissions: ['meeting_monitoring', 'inactivity_warning', 'automatic_meeting_end'],
    exposed: true,
    description: '会议助理，负责监控进行中的会议，在会议长时间未活动时发送提醒并自动结束会议。',
  },
];

const agentProfileSchema = new Schema(
  {
    roleCode: String,
    role: String,
    tools: [String],
    permissions: [String],
    permissionsManual: [String],
    permissionsDerived: [String],
    capabilities: [String],
    exposed: Boolean,
    description: String,
  },
  { collection: 'agent_profiles', strict: false },
);

const toolSchema = new Schema(
  {
    id: String,
    canonicalId: String,
    requiredPermissions: [{ id: String }],
  },
  { collection: 'tools', strict: false },
);

const AgentProfileModel = mongoose.model('McpProfileSeedAgentProfile', agentProfileSchema);
const ToolModel = mongoose.model<ToolRow>('McpProfileSeedToolLookup', toolSchema);

function normalizeStrings(items: string[]): string[] {
  return Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean))).sort();
}

function normalizeToolId(toolId: string): string {
  const normalized = String(toolId || '').trim();
  if (!normalized) return '';
  return LEGACY_TOOL_ID_ALIASES[normalized] || normalized;
}

function normalizeToolIds(toolIds: string[]): string[] {
  return normalizeStrings(toolIds || []).map((toolId) => normalizeToolId(toolId));
}

function normalizeIncomingPermissions(seed: McpProfileSeed): string[] {
  return normalizeStrings([...(seed.permissions || []), ...(seed.capabilities || [])]);
}



function parseArgs(argv: string[]): { mode: SeedMode; dryRun: boolean } {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  const modeRaw = modeArg ? modeArg.replace('--mode=', '').trim().toLowerCase() : 'sync';
  if (modeRaw && !['sync', 'append'].includes(modeRaw)) {
    throw new Error(`Unsupported seed mode: ${modeRaw}`);
  }
  return {
    mode: modeRaw === 'append' ? 'append' : 'sync',
    dryRun: argv.includes('--dry-run'),
  };
}

async function derivePermissionsFromTools(tools: string[]): Promise<string[]> {
  const normalizedTools = normalizeToolIds(tools || []);
  if (!normalizedTools.length) {
    return [];
  }
  const matchedTools = await ToolModel.find({
    $or: [{ id: { $in: normalizedTools } }, { canonicalId: { $in: normalizedTools } }],
  })
    .lean()
    .exec();
  const permissionIds = (matchedTools || []).flatMap((tool) =>
    (Array.isArray(tool.requiredPermissions) ? tool.requiredPermissions : [])
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean),
  );
  return normalizeStrings(permissionIds);
}

export async function seedMcpProfiles(mode: SeedMode = 'sync', options?: { dryRun?: boolean }): Promise<{ seeded: number; mode: SeedMode }> {
  bootstrapEnv();
  const mongoUri = getMongoUri();
  await mongoose.connect(mongoUri);

  let seeded = 0;
  try {
    for (const seed of MCP_PROFILE_SEEDS) {
      const normalizedSeedTools = normalizeToolIds(seed.tools || []);
      const manualPermissions = normalizeIncomingPermissions(seed);
      const permissionsDerived = await derivePermissionsFromTools(normalizedSeedTools);
      const permissions = normalizeStrings([...manualPermissions, ...permissionsDerived]);

      if (options?.dryRun) {
        seeded += 1;
        continue;
      }

      if (mode === 'append') {
        await AgentProfileModel.updateOne(
          { roleCode: seed.roleCode },
          {
            $setOnInsert: {
              roleCode: seed.roleCode,
              role: seed.role,
              permissions,
              permissionsManual: manualPermissions,
              permissionsDerived,
              capabilities: permissions,
              exposed: seed.exposed,
              description: seed.description || '',
            },
            $addToSet: {
              tools: { $each: normalizedSeedTools },
            },
          },
          { upsert: true },
        ).exec();
      } else {
        await AgentProfileModel.updateOne(
          { roleCode: seed.roleCode },
          {
            $set: {
              role: seed.role,
              tools: normalizedSeedTools,
              permissions,
              permissionsManual: manualPermissions,
              permissionsDerived,
              capabilities: permissions,
              exposed: seed.exposed,
              description: seed.description || '',
            },
          },
          { upsert: true },
        ).exec();
      }
      seeded += 1;
    }

    if (!options?.dryRun) {
      await AgentProfileModel.updateOne(
        { roleCode: 'human-exclusive-assistant' },
        {
          $addToSet: {
            tools: 'builtin.sys-mg.mcp.audit.list',
          },
        },
      ).exec();
    }

    return { seeded, mode };
  } finally {
    await mongoose.disconnect();
  }
}

async function run(): Promise<void> {
  const { mode, dryRun } = parseArgs(process.argv.slice(2));
  const result = await seedMcpProfiles(mode, { dryRun });
  console.log(`[seed:mcp-profiles] mode=${result.mode} seeded=${result.seeded} dryRun=${dryRun}`);
}

if (require.main === module) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[seed:mcp-profiles] failed: ${message}`);
    process.exit(1);
  });
}
