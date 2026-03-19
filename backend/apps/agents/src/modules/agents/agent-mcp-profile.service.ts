import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentProfile, AgentProfileDocument } from '../../../../../src/shared/schemas/agent-profile.schema';
import { Agent } from '../../../../../src/shared/schemas/agent.schema';
import { ToolService } from '../tools/tool.service';
import type { AgentMcpMapProfile, AgentMcpProfile, AgentMcpToolSummary, AgentToolPermissionSet } from './agent.types';

interface RoleLike {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: 'active' | 'inactive' | 'unknown';
}

const DEFAULT_MCP_PROFILE: AgentMcpMapProfile = {
  role: 'general-assistant',
  tools: [],
  permissions: [],
  permissionsManual: [],
  permissionsDerived: [],
  capabilities: [],
  exposed: false,
  description: 'No MCP profile found for this role',
};

const ORCHESTRATION_TOOL_IDS = {
  createPlan: 'builtin.sys-mg.mcp.orchestration.create-plan',
  updatePlan: 'builtin.sys-mg.mcp.orchestration.update-plan',
  runPlan: 'builtin.sys-mg.mcp.orchestration.run-plan',
  getPlan: 'builtin.sys-mg.mcp.orchestration.get-plan',
  listPlans: 'builtin.sys-mg.mcp.orchestration.list-plans',
  reassignTask: 'builtin.sys-mg.mcp.orchestration.reassign-task',
  completeHumanTask: 'builtin.sys-mg.mcp.orchestration.complete-human-task',
  createSchedule: 'builtin.sys-mg.mcp.orchestration.create-schedule',
  updateSchedule: 'builtin.sys-mg.mcp.orchestration.update-schedule',
  debugTask: 'builtin.sys-mg.mcp.orchestration.debug-task',
} as const;

const REQUIREMENT_TOOL_IDS = {
  list: 'builtin.sys-mg.mcp.requirement.list',
  get: 'builtin.sys-mg.mcp.requirement.get',
  create: 'builtin.sys-mg.mcp.requirement.create',
  updateStatus: 'builtin.sys-mg.mcp.requirement.update-status',
  assign: 'builtin.sys-mg.mcp.requirement.assign',
  comment: 'builtin.sys-mg.mcp.requirement.comment',
  syncGithub: 'builtin.sys-mg.mcp.requirement.sync-github',
  board: 'builtin.sys-mg.mcp.requirement.board',
} as const;

const INNER_MESSAGE_TOOL_IDS = {
  sendInternalMessage: 'builtin.sys-mg.mcp.inner-message.send-internal-message',
} as const;

const LEGACY_TOOL_ID_ALIASES: Record<string, string> = {
  'mcp.orchestration.createPlan': ORCHESTRATION_TOOL_IDS.createPlan,
  'mcp.orchestration.updatePlan': ORCHESTRATION_TOOL_IDS.updatePlan,
  'mcp.orchestration.runPlan': ORCHESTRATION_TOOL_IDS.runPlan,
  'mcp.orchestration.getPlan': ORCHESTRATION_TOOL_IDS.getPlan,
  'mcp.orchestration.listPlans': ORCHESTRATION_TOOL_IDS.listPlans,
  'mcp.orchestration.reassignTask': ORCHESTRATION_TOOL_IDS.reassignTask,
  'mcp.orchestration.completeHumanTask': ORCHESTRATION_TOOL_IDS.completeHumanTask,
  'mcp.orchestration.createSchedule': ORCHESTRATION_TOOL_IDS.createSchedule,
  'mcp.orchestration.updateSchedule': ORCHESTRATION_TOOL_IDS.updateSchedule,
  'mcp.orchestration.debugTask': ORCHESTRATION_TOOL_IDS.debugTask,
  'mcp.model.list': 'builtin.sys-mg.mcp.model-admin.list-models',
  'mcp.model.add': 'builtin.sys-mg.mcp.model-admin.add-model',
  'mcp.humanOperationLog.list': 'builtin.sys-mg.mcp.audit.list-human-operation-log',
  'builtin.sys-mg.mcp.humanOperationLog.list': 'builtin.sys-mg.mcp.audit.list-human-operation-log',
  'internal.agents.list': 'builtin.sys-mg.internal.agent-master.list-agents',
  'internal.content.extract': 'builtin.data-analysis.internal.content-analysis.extract',
  'internal.web.search': 'builtin.web-retrieval.internal.web-search.exa',
  'internal.web.fetch': 'builtin.web-retrieval.internal.web-fetch.fetch',
};

interface McpProfileSeed {
  roleCode: string;
  role: string;
  tools: string[];
  permissions?: string[];
  capabilities?: string[];
  exposed: boolean;
  description?: string;
}

const MCP_PROFILE_SEEDS: McpProfileSeed[] = [
  {
    roleCode: 'executive-lead',
    role: 'executive-lead',
    tools: [
      'builtin.web-retrieval.internal.web-search.exa',
      'builtin.web-retrieval.internal.web-fetch.fetch',
      'builtin.data-analysis.internal.content-analysis.extract',
      'builtin.sys-mg.internal.agent-master.list-agents',
      ORCHESTRATION_TOOL_IDS.createPlan,
      ORCHESTRATION_TOOL_IDS.updatePlan,
      ORCHESTRATION_TOOL_IDS.runPlan,
      ORCHESTRATION_TOOL_IDS.getPlan,
      ORCHESTRATION_TOOL_IDS.listPlans,
      ORCHESTRATION_TOOL_IDS.reassignTask,
      ORCHESTRATION_TOOL_IDS.completeHumanTask,
      ORCHESTRATION_TOOL_IDS.createSchedule,
      ORCHESTRATION_TOOL_IDS.updateSchedule,
      ORCHESTRATION_TOOL_IDS.debugTask,
      INNER_MESSAGE_TOOL_IDS.sendInternalMessage,
      REQUIREMENT_TOOL_IDS.list,
      REQUIREMENT_TOOL_IDS.get,
      REQUIREMENT_TOOL_IDS.create,
      REQUIREMENT_TOOL_IDS.updateStatus,
      REQUIREMENT_TOOL_IDS.assign,
      REQUIREMENT_TOOL_IDS.comment,
      REQUIREMENT_TOOL_IDS.syncGithub,
      REQUIREMENT_TOOL_IDS.board,
    ],
    permissions: ['strategy_planning', 'decision_making', 'stakeholder_communication', 'resource_governance'],
    exposed: true,
    description: '负责战略规划、关键决策与跨团队协同。',
  },
  {
    roleCode: 'management-assistant',
    role: 'management-assistant',
    tools: [
      'builtin.web-retrieval.internal.web-search.exa',
      'builtin.web-retrieval.internal.web-fetch.fetch',
      'builtin.data-analysis.internal.content-analysis.extract',
      'builtin.sys-mg.internal.agent-master.list-agents',
      ORCHESTRATION_TOOL_IDS.createPlan,
      ORCHESTRATION_TOOL_IDS.updatePlan,
      ORCHESTRATION_TOOL_IDS.runPlan,
      ORCHESTRATION_TOOL_IDS.getPlan,
      ORCHESTRATION_TOOL_IDS.listPlans,
      ORCHESTRATION_TOOL_IDS.createSchedule,
      ORCHESTRATION_TOOL_IDS.updateSchedule,
      ORCHESTRATION_TOOL_IDS.debugTask,
      INNER_MESSAGE_TOOL_IDS.sendInternalMessage,
      REQUIREMENT_TOOL_IDS.list,
      REQUIREMENT_TOOL_IDS.get,
      REQUIREMENT_TOOL_IDS.updateStatus,
      REQUIREMENT_TOOL_IDS.assign,
      REQUIREMENT_TOOL_IDS.comment,
      REQUIREMENT_TOOL_IDS.board,
    ],
    permissions: ['schedule_management', 'meeting_followup', 'information_synthesis'],
    exposed: true,
    description: '负责高管日程管理、会议纪要与事项跟进。',
  },
  {
    roleCode: 'technical-architect',
    role: 'technical-architect',
    tools: [
      'builtin.web-retrieval.internal.web-search.exa',
      'builtin.web-retrieval.internal.web-fetch.fetch',
      'builtin.data-analysis.internal.content-analysis.extract',
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
      'builtin.web-retrieval.internal.web-search.exa',
      'builtin.web-retrieval.internal.web-fetch.fetch',
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
    tools: ['builtin.web-retrieval.internal.web-search.exa', 'builtin.web-retrieval.internal.web-fetch.fetch', 'internal.content.extract'],
    permissions: ['deployment_automation', 'monitoring_alerting', 'incident_response'],
    exposed: true,
    description: '负责部署发布、监控告警与系统稳定性保障。',
  },
  {
    roleCode: 'data-analyst',
    role: 'data-analyst',
    tools: ['builtin.web-retrieval.internal.web-search.exa', 'builtin.web-retrieval.internal.web-fetch.fetch', 'internal.content.extract'],
    permissions: ['data_analysis', 'insight_generation', 'reporting'],
    exposed: true,
    description: '负责数据分析、结论提炼与报告输出。',
  },
  {
    roleCode: 'product-manager',
    role: 'product-manager',
    tools: [
      'builtin.web-retrieval.internal.web-search.exa',
      'builtin.web-retrieval.internal.web-fetch.fetch',
      ORCHESTRATION_TOOL_IDS.createPlan,
      ORCHESTRATION_TOOL_IDS.updatePlan,
      ORCHESTRATION_TOOL_IDS.runPlan,
      ORCHESTRATION_TOOL_IDS.getPlan,
      ORCHESTRATION_TOOL_IDS.listPlans,
      ORCHESTRATION_TOOL_IDS.createSchedule,
      ORCHESTRATION_TOOL_IDS.updateSchedule,
      ORCHESTRATION_TOOL_IDS.debugTask,
    ],
    permissions: ['requirement_planning', 'roadmap_management', 'cross_team_alignment'],
    exposed: true,
    description: '负责产品规划、优先级管理与跨团队推进。',
  },
  {
    roleCode: 'human-resources-manager',
    role: 'human-resources-manager',
    tools: ['internal.web.search'],
    permissions: ['talent_acquisition', 'performance_management', 'organization_development'],
    exposed: true,
    description: '负责招聘、绩效管理与组织人才发展。',
  },
  {
    roleCode: 'administrative-assistant',
    role: 'administrative-assistant',
    tools: ['builtin.web-retrieval.internal.web-search.exa', 'internal.web.fetch'],
    permissions: ['administrative_coordination', 'meeting_support', 'document_management'],
    exposed: true,
    description: '负责行政事务、会议支持与流程协同。',
  },
  {
    roleCode: 'marketing-strategist',
    role: 'marketing-strategist',
    tools: ['builtin.web-retrieval.internal.web-search.exa', 'builtin.web-retrieval.internal.web-fetch.fetch', 'internal.content.extract'],
    permissions: ['campaign_planning', 'brand_communication', 'growth_optimization'],
    exposed: true,
    description: '负责市场策略、活动策划与增长转化。',
  },
  {
    roleCode: 'human-exclusive-assistant',
    role: 'human-exclusive-assistant',
    tools: [
      'builtin.web-retrieval.internal.web-search.exa',
      'builtin.web-retrieval.internal.web-fetch.fetch',
      'builtin.data-analysis.internal.content-analysis.extract',
      'builtin.sys-mg.mcp.audit.list-human-operation-log',
    ],
    permissions: ['personal_schedule_management', 'task_followup', 'communication_drafting'],
    exposed: true,
    description: '面向人类用户的专属助理，负责个人事务协同与执行跟进。',
  },
  {
    roleCode: 'system-builtin-agent',
    role: 'system-builtin-agent',
    tools: [
      'builtin.web-retrieval.internal.web-search.exa',
      'builtin.web-retrieval.internal.web-fetch.fetch',
      'builtin.data-analysis.internal.content-analysis.extract',
      'builtin.sys-mg.internal.agent-master.list-agents',
      'builtin.sys-mg.mcp.model-admin.list-models',
      'builtin.sys-mg.mcp.model-admin.add-model',
      ORCHESTRATION_TOOL_IDS.createPlan,
      ORCHESTRATION_TOOL_IDS.runPlan,
      ORCHESTRATION_TOOL_IDS.getPlan,
      ORCHESTRATION_TOOL_IDS.listPlans,
      ORCHESTRATION_TOOL_IDS.reassignTask,
      ORCHESTRATION_TOOL_IDS.completeHumanTask,
      ORCHESTRATION_TOOL_IDS.createSchedule,
      ORCHESTRATION_TOOL_IDS.updateSchedule,
      ORCHESTRATION_TOOL_IDS.debugTask,
      INNER_MESSAGE_TOOL_IDS.sendInternalMessage,
      REQUIREMENT_TOOL_IDS.list,
      REQUIREMENT_TOOL_IDS.get,
      REQUIREMENT_TOOL_IDS.updateStatus,
      REQUIREMENT_TOOL_IDS.assign,
      REQUIREMENT_TOOL_IDS.comment,
      REQUIREMENT_TOOL_IDS.syncGithub,
      REQUIREMENT_TOOL_IDS.board,
    ],
    permissions: ['system_coordination', 'workflow_orchestration', 'platform_safeguard'],
    exposed: true,
    description: '系统内置类型，用于平台默认流程与系统任务协同。',
  },
  {
    roleCode: 'meeting-assistant',
    role: 'meeting-assistant',
    tools: [
      'builtin.sys-mg.mcp.meeting.list-meetings',
      'builtin.sys-mg.mcp.meeting.get-detail',
      'builtin.sys-mg.mcp.meeting.send-message',
      'builtin.sys-mg.mcp.meeting.update-status',
      'builtin.sys-mg.mcp.meeting.save-summary',
      INNER_MESSAGE_TOOL_IDS.sendInternalMessage,
    ],
    permissions: ['meeting_monitoring', 'inactivity_warning', 'automatic_meeting_end'],
    exposed: true,
    description: '会议助理，负责监控进行中的会议，在会议长时间未活动时发送提醒并自动结束会议。',
  },
];

@Injectable()
export class AgentMcpProfileService {
  private readonly logger = new Logger(AgentMcpProfileService.name);

  constructor(
    @InjectModel(AgentProfile.name) private readonly agentProfileModel: Model<AgentProfileDocument>,
    private readonly toolService: ToolService,
  ) {}

  async ensureMcpProfileSeeds(mode: 'sync' | 'append' = 'sync'): Promise<void> {
    try {
      for (const seed of MCP_PROFILE_SEEDS) {
        const normalizedSeedTools = this.normalizeToolIds(seed.tools || []);
        const manualPermissions = this.normalizeIncomingPermissions(seed);
        const permissionsDerived = await this.derivePermissionsFromTools(normalizedSeedTools);
        const permissions = this.uniqueStrings(manualPermissions, permissionsDerived);

        if (mode === 'append') {
          await this.agentProfileModel
            .updateOne(
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
            )
            .exec();
          continue;
        }

        await this.agentProfileModel
          .updateOne(
            { roleCode: seed.roleCode },
            {
              $setOnInsert: {
                role: seed.role,
                permissions,
                permissionsManual: manualPermissions,
                permissionsDerived,
                capabilities: permissions,
                exposed: seed.exposed,
                description: seed.description || '',
              },
              $set: {
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
          )
          .exec();
      }

      await this.agentProfileModel
        .updateOne(
          { roleCode: 'human-exclusive-assistant' },
          {
            $addToSet: {
              tools: 'builtin.sys-mg.mcp.audit.list-human-operation-log',
            },
          },
        )
        .exec();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to seed MCP profiles';
      this.logger.warn(`MCP profile seed skipped: ${message}`);
    }
  }

  async getAgentsMcpMap(): Promise<Record<string, AgentMcpMapProfile>> {
    const profiles = await this.agentProfileModel.find().exec();
    const record: Record<string, AgentMcpMapProfile> = {};
    for (const profile of profiles) {
      record[profile.roleCode] = this.toAgentMcpMapProfile(profile);
    }
    return record;
  }

  async getMcpProfilesByRoleCodes(roleCodes: string[]): Promise<Map<string, AgentMcpMapProfile>> {
    const uniqueRoleCodes = Array.from(new Set(roleCodes.map((item) => item.trim()).filter(Boolean)));
    if (!uniqueRoleCodes.length) {
      return new Map();
    }

    const profiles = await this.agentProfileModel.find({ roleCode: { $in: uniqueRoleCodes } }).exec();
    const map = new Map<string, AgentMcpMapProfile>();
    for (const profile of profiles) {
      map.set(profile.roleCode, this.toAgentMcpMapProfile(profile));
    }
    return map;
  }

  async getMcpProfileByRoleCode(roleCode?: string): Promise<AgentMcpMapProfile> {
    const normalizedRoleCode = String(roleCode || '').trim();
    if (!normalizedRoleCode) {
      return DEFAULT_MCP_PROFILE;
    }

    const roleProfile = await this.agentProfileModel.findOne({ roleCode: normalizedRoleCode }).exec();
    if (!roleProfile) {
      return DEFAULT_MCP_PROFILE;
    }
    return this.toAgentMcpMapProfile(roleProfile);
  }

  async getMcpProfiles(): Promise<AgentProfile[]> {
    const profiles = await this.agentProfileModel.find().sort({ roleCode: 1 }).exec();
    return profiles.map((profile) => this.normalizeProfileEntity(profile));
  }

  async getMcpProfile(roleCode: string): Promise<AgentProfile | null> {
    const profile = await this.agentProfileModel.findOne({ roleCode: roleCode.trim() }).exec();
    if (!profile) return null;
    return this.normalizeProfileEntity(profile);
  }

  async upsertMcpProfile(roleCode: string, updates: Partial<AgentMcpMapProfile>): Promise<AgentProfile> {
    const normalizedRoleCode = roleCode.trim();
    if (!normalizedRoleCode) {
      throw new BadRequestException('roleCode is required');
    }

    const existing = await this.agentProfileModel.findOne({ roleCode: normalizedRoleCode }).lean().exec();
    const normalizedTools = this.normalizeToolIds(
      Object.prototype.hasOwnProperty.call(updates, 'tools') ? updates.tools || [] : ((existing as any)?.tools || []),
    );
    const hasManualPermissionUpdates =
      Object.prototype.hasOwnProperty.call(updates, 'permissions') ||
      Object.prototype.hasOwnProperty.call(updates, 'capabilities') ||
      Object.prototype.hasOwnProperty.call(updates, 'permissionsManual');
    const manualPermissions = hasManualPermissionUpdates
      ? this.normalizeIncomingPermissions(updates)
      : this.normalizeIncomingPermissions((existing as any) || {});
    const permissionsDerived = await this.derivePermissionsFromTools(normalizedTools);
    const payload: Partial<AgentProfile> = {
      role: updates.role || String((existing as any)?.role || '').trim() || DEFAULT_MCP_PROFILE.role,
      tools: normalizedTools,
      permissionsManual: manualPermissions,
      permissionsDerived,
      permissions: this.uniqueStrings(manualPermissions, permissionsDerived),
      capabilities: this.uniqueStrings(manualPermissions, permissionsDerived),
      exposed: Object.prototype.hasOwnProperty.call(updates, 'exposed')
        ? updates.exposed === true
        : (existing as any)?.exposed === true,
      description: Object.prototype.hasOwnProperty.call(updates, 'description')
        ? updates.description || ''
        : String((existing as any)?.description || ''),
    };

    const profile = await this.agentProfileModel
      .findOneAndUpdate({ roleCode: normalizedRoleCode }, { ...payload, roleCode: normalizedRoleCode }, { new: true, upsert: true })
      .exec();
    return this.normalizeProfileEntity(profile);
  }

  async getToolPermissionSets(roles: RoleLike[]): Promise<AgentToolPermissionSet[]> {
    const roleCodes = Array.from(new Set(roles.map((role) => String(role.code || '').trim()).filter(Boolean)));
    const profiles = await this.agentProfileModel.find({ roleCode: { $in: roleCodes } }).exec();
    const profileMap = new Map(profiles.map((profile) => [String(profile.roleCode || '').trim(), profile]));

    return roles.map((role) => {
      const roleCode = String(role.code || '').trim();
      const profile = profileMap.get(roleCode);
      return {
        roleId: role.id,
        roleCode,
        roleName: role.name || roleCode,
        roleStatus: role.status || 'unknown',
        tools: this.normalizeToolIds(profile?.tools || []),
        permissions: this.resolveProfilePermissions(profile),
        permissionsManual: this.normalizeStringArray((profile as any)?.permissionsManual || []),
        permissionsDerived: this.normalizeStringArray((profile as any)?.permissionsDerived || []),
        capabilities: this.resolveProfilePermissions(profile),
        exposed: profile?.exposed === true,
        description: profile?.description || role.description || '',
      };
    });
  }

  async upsertToolPermissionSet(
    roleCode: string,
    updates: Partial<Pick<AgentMcpMapProfile, 'tools' | 'permissions' | 'capabilities' | 'exposed' | 'description'>>,
    roles: RoleLike[],
  ): Promise<AgentToolPermissionSet> {
    const normalizedRoleCode = String(roleCode || '').trim();
    if (!normalizedRoleCode) {
      throw new BadRequestException('roleCode is required');
    }

    const role = roles.find((item) => String(item.code || '').trim() === normalizedRoleCode);
    if (!role) {
      throw new BadRequestException(`Role code not found: ${normalizedRoleCode}`);
    }

    const existing = await this.agentProfileModel.findOne({ roleCode: normalizedRoleCode }).lean().exec();
    const normalizedTools = this.normalizeToolIds(
      Object.prototype.hasOwnProperty.call(updates, 'tools') ? updates.tools || [] : ((existing as any)?.tools || []),
    );
    const hasManualPermissionUpdates =
      Object.prototype.hasOwnProperty.call(updates, 'permissions') ||
      Object.prototype.hasOwnProperty.call(updates, 'capabilities') ||
      Object.prototype.hasOwnProperty.call(updates, 'permissionsManual');
    const manualPermissions = hasManualPermissionUpdates
      ? this.normalizeIncomingPermissions(updates)
      : this.normalizeIncomingPermissions((existing as any) || {});
    const permissionsDerived = await this.derivePermissionsFromTools(normalizedTools);
    const mergedPermissions = this.uniqueStrings(manualPermissions, permissionsDerived);

    const payload: Partial<AgentProfile> = {
      role: normalizedRoleCode,
      tools: normalizedTools,
      permissionsManual: manualPermissions,
      permissionsDerived,
      permissions: mergedPermissions,
      capabilities: mergedPermissions,
      exposed: Object.prototype.hasOwnProperty.call(updates, 'exposed')
        ? updates.exposed === true
        : (existing as any)?.exposed === true,
      description: Object.prototype.hasOwnProperty.call(updates, 'description')
        ? updates.description || ''
        : String((existing as any)?.description || ''),
    };

    const profile = await this.agentProfileModel
      .findOneAndUpdate({ roleCode: normalizedRoleCode }, { ...payload, roleCode: normalizedRoleCode }, { new: true, upsert: true })
      .exec();

    return {
      roleId: role.id,
      roleCode: normalizedRoleCode,
      roleName: role.name || normalizedRoleCode,
      roleStatus: role.status || 'unknown',
      tools: this.normalizeToolIds(profile?.tools || []),
      permissions: this.resolveProfilePermissions(profile),
      permissionsManual: this.normalizeStringArray((profile as any)?.permissionsManual || []),
      permissionsDerived: this.normalizeStringArray((profile as any)?.permissionsDerived || []),
      capabilities: this.resolveProfilePermissions(profile),
      exposed: profile?.exposed === true,
      description: profile?.description || role.description || '',
    };
  }

  async resetToolPermissionSetsBySystemRoles(roles: RoleLike[]): Promise<{
    totalRoles: number;
    resetCount: number;
    missingRoleCodes: string[];
  }> {
    const systemSeeds = new Map<string, { tools: string[]; permissionsManual: string[]; exposed: boolean; description: string }>();
    for (const seed of MCP_PROFILE_SEEDS) {
      const roleCode = String(seed.role || '').trim();
      if (!roleCode) {
        continue;
      }
      const existing = systemSeeds.get(roleCode);
      if (!existing) {
        systemSeeds.set(roleCode, {
          tools: this.normalizeToolIds(seed.tools || []),
          permissionsManual: this.normalizeIncomingPermissions(seed),
          exposed: seed.exposed === true,
          description: seed.description || '',
        });
        continue;
      }
      existing.tools = this.uniqueStrings(existing.tools, this.normalizeToolIds(seed.tools || []));
      existing.permissionsManual = this.uniqueStrings(existing.permissionsManual, this.normalizeIncomingPermissions(seed));
      existing.exposed = existing.exposed || seed.exposed === true;
      if (!existing.description && seed.description) {
        existing.description = seed.description;
      }
    }

    const roleCodeSet = new Set(roles.map((role) => String(role.code || '').trim()).filter(Boolean));
    const missingRoleCodes: string[] = [];
    let resetCount = 0;

    for (const [roleCode, seed] of systemSeeds.entries()) {
      if (!roleCodeSet.has(roleCode)) {
        missingRoleCodes.push(roleCode);
        continue;
      }

      const permissionsDerived = await this.derivePermissionsFromTools(seed.tools || []);
      const permissions = this.uniqueStrings(seed.permissionsManual || [], permissionsDerived);
      await this.agentProfileModel
        .findOneAndUpdate(
          { roleCode },
          {
            roleCode,
            role: roleCode,
            tools: this.normalizeToolIds(seed.tools || []),
            permissionsManual: seed.permissionsManual || [],
            permissionsDerived,
            permissions,
            capabilities: permissions,
            exposed: seed.exposed === true,
            description: seed.description || '',
          },
          { upsert: true, new: true },
        )
        .exec();
      resetCount += 1;
    }

    return {
      totalRoles: roles.length,
      resetCount,
      missingRoleCodes,
    };
  }

  async buildAgentMcpProfiles(
    agents: Agent[],
    roleMap: Map<string, RoleLike>,
  ): Promise<AgentMcpProfile[]> {
    const profileKeys = agents.map((agent) => this.resolveProfileLookupKey(roleMap.get(agent.roleId)));
    const profileMap = await this.getMcpProfilesByRoleCodes(profileKeys);
    const toolMap = await this.buildToolSummaryMap(agents, profileMap, roleMap);

    return agents.map((agent) => {
      const role = roleMap.get(agent.roleId);
      const mapKey = this.resolveProfileLookupKey(role);
      const profile = profileMap.get(mapKey) || DEFAULT_MCP_PROFILE;
      return this.toMcpProfile(agent, profile, mapKey, toolMap, role);
    });
  }

  async buildSingleAgentMcpProfile(agent: Agent, role?: RoleLike): Promise<AgentMcpProfile> {
    const mapKey = this.resolveProfileLookupKey(role);
    const mapProfile = await this.getMcpProfileByRoleCode(role?.code);
    const roleMap = new Map<string, RoleLike>();
    if (role) {
      roleMap.set(agent.roleId, role);
    }
    const toolMap = await this.buildToolSummaryMap([agent], new Map([[mapKey, mapProfile]]), roleMap);
    return this.toMcpProfile(agent, mapProfile, mapKey, toolMap, role);
  }

  private resolveProfileLookupKey(role?: RoleLike): string {
    const roleCode = String(role?.code || '').trim();
    if (roleCode) return roleCode;
    return '';
  }

  private async buildToolSummaryMap(
    agents: Agent[],
    profileMap: Map<string, AgentMcpMapProfile>,
    roleMap?: Map<string, RoleLike>,
  ): Promise<Map<string, AgentMcpToolSummary>> {
    const mergedIds = this.uniqueStrings(
      ...agents.map((agent) => {
        const mapKey = this.resolveProfileLookupKey(roleMap?.get(agent.roleId));
        const mapProfile = profileMap.get(mapKey) || DEFAULT_MCP_PROFILE;
        return [...(agent.tools || []), ...(mapProfile.tools || [])];
      }),
    ).map((toolId) => this.normalizeToolId(toolId));

    if (!mergedIds.length) {
      return new Map();
    }

    const tools = await this.toolService.getToolsByIds(mergedIds);
    const summaryMap = new Map<string, AgentMcpToolSummary>();
    for (const tool of tools as any[]) {
      const canonicalId = tool.canonicalId || this.normalizeToolId(tool.id);
      const summary = {
        id: canonicalId,
        name: tool.name,
        description: tool.description,
        type: tool.type,
        category: tool.category,
      };
      summaryMap.set(canonicalId, summary);
      summaryMap.set(tool.id, summary);
    }
    return summaryMap;
  }

  private toMcpProfile(
    agent: Agent,
    profile: AgentMcpMapProfile,
    mapKey: string,
    toolMap: Map<string, AgentMcpToolSummary>,
    role?: RoleLike,
  ): AgentMcpProfile {
    const toolIds = this.uniqueStrings(agent.tools || [], profile.tools || []).map((toolId) => this.normalizeToolId(toolId));
    const toolSet = toolIds.map((toolId) => {
      const existing = toolMap.get(toolId);
      if (existing) return existing;
      return {
        id: toolId,
        name: toolId,
        description: 'Tool metadata not found in registry',
      };
    });

    return {
      id: agent.id || '',
      name: agent.name,
      description: agent.description || profile.description || '',
      roleId: agent.roleId,
      role: role?.name || role?.code || profile.role,
      capabilitySet: this.uniqueStrings(agent.capabilities || [], profile.permissions || profile.capabilities || []),
      toolSet,
      exposed: profile.exposed === true,
      mapKey: mapKey || 'default',
    };
  }

  private toAgentMcpMapProfile(profile: Partial<AgentProfile>): AgentMcpMapProfile {
    const tools = this.normalizeToolIds(profile.tools || []);
    const permissionsManual = this.normalizeStringArray(profile.permissionsManual || []);
    const permissionsDerived = this.normalizeStringArray(profile.permissionsDerived || []);
    const permissions = this.resolveProfilePermissions(profile);
    return {
      role: String(profile.role || '').trim() || DEFAULT_MCP_PROFILE.role,
      tools,
      permissions,
      permissionsManual,
      permissionsDerived,
      capabilities: permissions,
      exposed: profile.exposed === true,
      description: profile.description || '',
    };
  }

  private normalizeProfileEntity(profile: any): AgentProfile {
    const plain = profile?.toObject ? profile.toObject() : profile;
    const normalized = this.toAgentMcpMapProfile(plain || {});
    return {
      ...plain,
      tools: normalized.tools,
      permissions: normalized.permissions,
      permissionsManual: normalized.permissionsManual || [],
      permissionsDerived: normalized.permissionsDerived || [],
      capabilities: normalized.permissions,
    } as AgentProfile;
  }

  private resolveProfilePermissions(profile: Partial<AgentProfile> | null | undefined): string[] {
    if (!profile) {
      return [];
    }
    const combined = this.uniqueStrings(
      this.normalizeStringArray(profile.permissions || []),
      this.normalizeStringArray(profile.permissionsManual || []),
      this.normalizeStringArray(profile.permissionsDerived || []),
      this.normalizeStringArray(profile.capabilities || []),
    );
    return combined;
  }

  private normalizeIncomingPermissions(updates: Partial<AgentMcpMapProfile> | Partial<AgentProfile>): string[] {
    const profileLike = updates as Partial<AgentProfile>;
    return this.uniqueStrings(
      this.normalizeStringArray((updates as any)?.permissions || []),
      this.normalizeStringArray(profileLike.permissionsManual || []),
      this.normalizeStringArray((updates as any)?.capabilities || []),
    );
  }

  private async derivePermissionsFromTools(tools: string[]): Promise<string[]> {
    const normalizedTools = this.normalizeToolIds(tools || []);
    if (!normalizedTools.length) {
      return [];
    }
    const matchedTools = await this.toolService.getToolsByIds(normalizedTools);
    const permissionIds = (matchedTools || []).flatMap((tool: any) =>
      (Array.isArray(tool.requiredPermissions) ? tool.requiredPermissions : [])
        .map((item: any) => String(item?.id || '').trim())
        .filter(Boolean),
    );
    return this.normalizeStringArray(permissionIds);
  }

  private normalizeStringArray(items: string[]): string[] {
    return Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean))).sort();
  }

  private normalizeToolId(toolId: string): string {
    const normalized = String(toolId || '').trim();
    if (!normalized) return '';
    return LEGACY_TOOL_ID_ALIASES[normalized] || normalized;
  }

  private normalizeToolIds(toolIds: string[]): string[] {
    return this.uniqueStrings(toolIds || []).map((toolId) => this.normalizeToolId(toolId));
  }

  private uniqueStrings(...groups: string[][]): string[] {
    const merged = groups.flat().map((item) => String(item || '').trim()).filter(Boolean);
    return Array.from(new Set(merged));
  }
}
