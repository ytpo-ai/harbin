import mongoose, { Schema } from 'mongoose';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

type AgentProfileRow = {
  _id: unknown;
  roleCode?: string;
  tools?: string[];
  permissions?: string[];
  permissionsManual?: string[];
  permissionsDerived?: string[];
  capabilities?: string[];
};

type ToolRow = {
  id: string;
  canonicalId?: string;
  requiredPermissions?: Array<{ id?: string }>;
};

const agentProfileSchema = new Schema(
  {
    roleCode: String,
    tools: [String],
    permissions: [String],
    permissionsManual: [String],
    permissionsDerived: [String],
    capabilities: [String],
  },
  { collection: 'agentprofiles', strict: false },
);

const toolSchema = new Schema(
  {
    id: String,
    canonicalId: String,
    requiredPermissions: [{ id: String }],
  },
  { collection: 'tools', strict: false },
);

const AgentProfileModel = mongoose.model<AgentProfileRow>('AgentProfilePermissionMigration', agentProfileSchema);
const ToolModel = mongoose.model<ToolRow>('ToolPermissionLookup', toolSchema);

function loadEnvFromFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function bootstrapEnv(): void {
  const root = resolve(__dirname, '..');
  loadEnvFromFile(resolve(root, '.env'));
  loadEnvFromFile(resolve(root, '.env.development'));
  loadEnvFromFile(resolve(root, '.env.local'));
}

function parseArgs(argv: string[]) {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

function normalizeStrings(items: string[]): string[] {
  return Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean))).sort();
}

async function derivePermissionsFromTools(tools: string[]): Promise<string[]> {
  const normalizedTools = normalizeStrings(tools || []);
  if (!normalizedTools.length) {
    return [];
  }

  const rows = await ToolModel.find({
    $or: [{ id: { $in: normalizedTools } }, { canonicalId: { $in: normalizedTools } }],
  })
    .lean()
    .exec();

  const permissionIds = (rows || []).flatMap((tool) =>
    (Array.isArray(tool.requiredPermissions) ? tool.requiredPermissions : [])
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean),
  );
  return normalizeStrings(permissionIds);
}

async function run(): Promise<void> {
  bootstrapEnv();
  const { dryRun } = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agent-team';
  await mongoose.connect(mongoUri);

  let scanned = 0;
  let updated = 0;

  try {
    const profiles = await AgentProfileModel.find().lean().exec();
    for (const profile of profiles) {
      scanned += 1;
      const tools = normalizeStrings(profile.tools || []);
      const existingPermissions = normalizeStrings(profile.permissions || []);
      const legacyCapabilities = normalizeStrings(profile.capabilities || []);
      const existingManual = normalizeStrings(profile.permissionsManual || []);

      const permissionsManual = normalizeStrings(
        existingManual.length ? existingManual : existingPermissions.length ? existingPermissions : legacyCapabilities,
      );
      const permissionsDerived = await derivePermissionsFromTools(tools);
      const permissions = normalizeStrings([...permissionsManual, ...permissionsDerived]);
      const capabilities = permissions;

      const nextPayload = {
        tools,
        permissions,
        permissionsManual,
        permissionsDerived,
        capabilities,
      };

      const unchanged =
        JSON.stringify(tools) === JSON.stringify(normalizeStrings(profile.tools || [])) &&
        JSON.stringify(permissions) === JSON.stringify(existingPermissions) &&
        JSON.stringify(permissionsManual) === JSON.stringify(existingManual) &&
        JSON.stringify(permissionsDerived) === JSON.stringify(normalizeStrings(profile.permissionsDerived || [])) &&
        JSON.stringify(capabilities) === JSON.stringify(legacyCapabilities);

      if (unchanged) {
        continue;
      }

      if (dryRun) {
        console.log(`[dry-run] roleCode=${String(profile.roleCode || '')} permissions=${permissions.length} derived=${permissionsDerived.length}`);
        continue;
      }

      await AgentProfileModel.updateOne({ _id: profile._id }, { $set: nextPayload }).exec();
      updated += 1;
    }
  } finally {
    await mongoose.disconnect();
  }

  console.log(`[migrate-agent-profile-permissions] scanned=${scanned} updated=${updated} dryRun=${dryRun}`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate-agent-profile-permissions] failed: ${message}`);
  process.exit(1);
});
