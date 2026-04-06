import mongoose, { Schema } from 'mongoose';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';

type SeedMode = 'sync' | 'append';

type AgentProfileRow = {
  roleCode?: string;
  tools?: string[];
  permissions?: string[];
  permissionsManual?: string[];
  permissionsDerived?: string[];
  capabilities?: string[];
};

type AgentRow = {
  id?: string;
  _id?: unknown;
  name?: string;
  roleId?: string;
  tools?: string[];
  permissions?: string[];
};

type AgentRoleRow = {
  id?: string;
  code?: string;
};

const HR_ROLE_CODE = 'human-resources-manager';
const DEFAULT_AGENT_NAME = 'hr agent';

const ROLE_MASTER_TOOL_IDS = [
  'builtin.sys-mg.mcp.agent-role.list',
  'builtin.sys-mg.mcp.agent-role.create',
  'builtin.sys-mg.mcp.agent-role.update',
  'builtin.sys-mg.mcp.agent-role.delete',
];

const ROLE_MASTER_PERMISSION_IDS = ['agent_role_registry_read', 'agent_role_registry_write'];

const agentProfileSchema = new Schema(
  {
    roleCode: String,
    tools: [String],
    permissions: [String],
    permissionsManual: [String],
    permissionsDerived: [String],
    capabilities: [String],
  },
  { collection: 'agent_profiles', strict: false },
);

const agentSchema = new Schema(
  {
    id: String,
    name: String,
    roleId: String,
    tools: [String],
    permissions: [String],
  },
  { collection: 'agents', strict: false },
);

const agentRoleSchema = new Schema(
  {
    id: String,
    code: String,
  },
  { collection: 'agent_roles', strict: false },
);

const AgentProfileModel = mongoose.model<AgentProfileRow>('HrRoleMasterSeedAgentProfile', agentProfileSchema);
const AgentModel = mongoose.model<AgentRow>('HrRoleMasterSeedAgent', agentSchema);
const AgentRoleModel = mongoose.model<AgentRoleRow>('HrRoleMasterSeedAgentRole', agentRoleSchema);

function normalizeStrings(items: string[]): string[] {
  return Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean)));
}

function parseArgs(argv: string[]): { mode: SeedMode; dryRun: boolean; agentId?: string; agentName: string } {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  const modeRaw = modeArg ? modeArg.replace('--mode=', '').trim().toLowerCase() : 'sync';
  if (modeRaw && !['sync', 'append'].includes(modeRaw)) {
    throw new Error(`Unsupported seed mode: ${modeRaw}`);
  }

  const agentIdArg = argv.find((arg) => arg.startsWith('--agent-id='));
  const agentNameArg = argv.find((arg) => arg.startsWith('--agent-name='));

  return {
    mode: modeRaw === 'append' ? 'append' : 'sync',
    dryRun: argv.includes('--dry-run'),
    agentId: agentIdArg ? agentIdArg.replace('--agent-id=', '').trim() : undefined,
    agentName: (agentNameArg ? agentNameArg.replace('--agent-name=', '').trim() : DEFAULT_AGENT_NAME) || DEFAULT_AGENT_NAME,
  };
}

export async function seedHrAgentRoleMasterBinding(
  mode: SeedMode = 'sync',
  options?: { dryRun?: boolean; agentId?: string; agentName?: string },
): Promise<{
  mode: SeedMode;
  dryRun: boolean;
  targetRoleCode: string;
  targetRoleId: string;
  matchedAgents: number;
  updatedAgents: string[];
}> {
  bootstrapEnv();
  const mongoUri = getMongoUri();
  await mongoose.connect(mongoUri);

  const dryRun = options?.dryRun === true;
  const targetAgentId = String(options?.agentId || '').trim();
  const targetAgentName = String(options?.agentName || DEFAULT_AGENT_NAME).trim() || DEFAULT_AGENT_NAME;

  try {
    const role = await AgentRoleModel.findOne({ code: HR_ROLE_CODE }).lean().exec();
    const roleId = String(role?.id || '').trim();
    if (!roleId) {
      throw new Error(`Role code not found: ${HR_ROLE_CODE}`);
    }

    if (!dryRun) {
      const profile = await AgentProfileModel.findOne({ roleCode: HR_ROLE_CODE }).lean().exec();
      const existingTools = normalizeStrings(profile?.tools || []);
      const existingManualPermissions = normalizeStrings(profile?.permissionsManual || profile?.permissions || profile?.capabilities || []);
      const existingDerivedPermissions = normalizeStrings(profile?.permissionsDerived || []);

      const nextTools = normalizeStrings([...existingTools, ...ROLE_MASTER_TOOL_IDS]);

      const nextPermissionsManual = normalizeStrings([...existingManualPermissions, ...ROLE_MASTER_PERMISSION_IDS]);
      const nextPermissions = normalizeStrings([...nextPermissionsManual, ...existingDerivedPermissions]);

      await AgentProfileModel.updateOne(
        { roleCode: HR_ROLE_CODE },
        {
          $set: {
            roleCode: HR_ROLE_CODE,
            tools: nextTools,
            permissionsManual: nextPermissionsManual,
            permissions: nextPermissions,
            capabilities: nextPermissions,
          },
        },
        { upsert: true },
      ).exec();
    }

    const agentQuery: Record<string, unknown> = { roleId };
    if (targetAgentId) {
      agentQuery.$or = [{ id: targetAgentId }, { _id: targetAgentId }];
    }
    const candidates = (await AgentModel.find(agentQuery).lean().exec()) as AgentRow[];
    const nameLower = targetAgentName.toLowerCase();
    const matchedByName = candidates.filter((agent) => String(agent?.name || '').trim().toLowerCase() === nameLower);
    const matchedAgents = targetAgentId
      ? candidates
      : matchedByName.length
        ? matchedByName
        : candidates;

    const updatedAgents: string[] = [];
    if (!dryRun) {
      for (const agent of matchedAgents) {
        const agentId = String(agent.id || agent._id || '').trim();
        if (!agentId) {
          continue;
        }
        const nextTools = normalizeStrings([...(agent.tools || []), ...ROLE_MASTER_TOOL_IDS]);
        const nextPermissions = normalizeStrings([...(agent.permissions || []), ...ROLE_MASTER_PERMISSION_IDS]);
        await AgentModel.updateOne(
          { $or: [{ id: agentId }, { _id: agentId }] },
          {
            $set: {
              tools: nextTools,
              permissions: nextPermissions,
            },
          },
        ).exec();
        updatedAgents.push(agentId);
      }
    }

    return {
      mode,
      dryRun,
      targetRoleCode: HR_ROLE_CODE,
      targetRoleId: roleId,
      matchedAgents: matchedAgents.length,
      updatedAgents,
    };
  } finally {
    await mongoose.disconnect();
  }
}

async function run(): Promise<void> {
  const { mode, dryRun, agentId, agentName } = parseArgs(process.argv.slice(2));
  const result = await seedHrAgentRoleMasterBinding(mode, { dryRun, agentId, agentName });
  console.log(
    `[seed:hr-agent-role-master] mode=${result.mode} dryRun=${result.dryRun} ` +
      `role=${result.targetRoleCode}(${result.targetRoleId}) matched=${result.matchedAgents} updated=${result.updatedAgents.length}`,
  );
}

if (require.main === module) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[seed:hr-agent-role-master] failed: ${message}`);
    process.exit(1);
  });
}
