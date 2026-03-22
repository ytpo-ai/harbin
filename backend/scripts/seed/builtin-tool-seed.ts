import mongoose, { Schema } from 'mongoose';
import {
  BUILTIN_TOOLS,
  IMPLEMENTED_TOOL_IDS,
} from '../../apps/agents/src/modules/tools/builtin-tool-catalog';
import {
  DEPRECATED_TOOL_IDS,
  VIRTUAL_TOOL_IDS,
} from '../../apps/agents/src/modules/tools/builtin-tool-definitions';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';

type SeedMode = 'sync' | 'append';

type BuiltinTool = (typeof BUILTIN_TOOLS)[number];

interface ParsedToolIdentity {
  provider: string;
  executionChannel: string;
  namespace: string;
  toolkit: string;
  toolkitId: string;
  resource: string;
  action: string;
}

const toolSchema = new Schema(
  {
    id: String,
    canonicalId: String,
    provider: String,
    executionChannel: String,
    toolkitId: String,
    namespace: String,
    resource: String,
    action: String,
    name: String,
    description: String,
    prompt: String,
    type: String,
    category: String,
    capabilitySet: [String],
    tags: [String],
    status: String,
    deprecated: Boolean,
    replacedBy: String,
    aliases: [String],
    enabled: Boolean,
    config: Object,
    inputSchema: Object,
    outputSchema: Object,
    requiredPermissions: [Object],
    tokenCost: Number,
    executionTime: Number,
    implementation: Object,
  },
  { collection: 'agent_tools', strict: false, timestamps: true },
);

const toolkitSchema = new Schema(
  {
    id: String,
    provider: String,
    executionChannel: String,
    namespace: String,
    name: String,
    description: String,
    version: String,
    authStrategy: String,
    status: String,
    metadata: Object,
  },
  { collection: 'agent_toolkits', strict: false, timestamps: true },
);

const ToolModel = mongoose.model('BuiltinToolSeedTool', toolSchema);
const ToolkitModel = mongoose.model('BuiltinToolSeedToolkit', toolkitSchema);

function parseToolIdentity(toolId: string): ParsedToolIdentity {
  const parts = String(toolId || '')
    .split('.')
    .filter(Boolean);
  if (!parts.length) {
    return {
      provider: 'builtin',
      executionChannel: 'internal',
      namespace: 'other',
      toolkit: 'generic',
      toolkitId: 'builtin.other.internal.generic',
      resource: 'generic',
      action: 'execute',
    };
  }

  if (
    (parts[0] === 'builtin' || parts[0] === 'composio') &&
    parts.length >= 5 &&
    ['mcp', 'internal'].includes(parts[2])
  ) {
    const provider = parts[0];
    const namespace = parts[1] || 'other';
    const executionChannel = parts[2] || 'internal';
    const toolkit = parts[3] || 'generic';
    const action = parts.slice(4).join('.') || 'execute';
    return {
      provider,
      executionChannel,
      namespace,
      toolkit,
      toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
      resource: toolkit,
      action,
    };
  }

  if (parts[0] === 'builtin' || parts[0] === 'composio') {
    const provider = parts[0];
    const executionChannel = parts[1] || (provider === 'composio' ? 'mcp' : 'internal');
    const namespace = parts[2] || 'other';
    const toolkit = parts[2] || 'generic';
    const resource = parts[2] || 'generic';
    const action = parts.slice(3).join('.') || 'execute';
    return {
      provider,
      executionChannel,
      namespace,
      toolkit,
      toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
      resource,
      action,
    };
  }

  if (parts[0] === 'gh') {
    const provider = 'builtin';
    const executionChannel = 'mcp';
    const namespace = 'sys-mg';
    const toolkit = 'rd-related';
    const action = parts.slice(1).join('.') || 'execute';
    return {
      provider,
      executionChannel,
      namespace,
      toolkit,
      toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
      resource: toolkit,
      action,
    };
  }

  const provider = parts[0] === 'composio' ? 'composio' : 'builtin';
  const executionChannel = parts[0] === 'internal' ? 'internal' : parts[1] || 'internal';
  const namespace = parts[2] || parts[1] || parts[0] || 'other';
  const toolkit = parts[3] || namespace;
  const action = parts.slice(4).join('.') || parts.slice(3).join('.') || 'execute';
  return {
    provider,
    executionChannel,
    namespace,
    toolkit,
    toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
    resource: toolkit,
    action,
  };
}

function inferResourceAndAction(toolId: string): {
  resource: string;
  action: string;
} {
  const parsed = parseToolIdentity(toolId);
  return { resource: parsed.resource, action: parsed.action };
}

function inferToolkitFromToolId(toolId: string): string {
  return parseToolIdentity(toolId).toolkit;
}

function getToolkitDisplayName(toolkit: string): string {
  if (toolkit === 'rd-related') return 'RD Toolkit';
  return toolkit
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function inferToolkitAuthStrategy(
  provider: string,
  namespace: string,
  toolkit?: string,
): 'oauth2' | 'apiKey' | 'none' {
  if (
    provider === 'composio' &&
    ['gmail', 'slack', 'github'].includes(toolkit || namespace)
  ) {
    return 'oauth2';
  }
  if (provider === 'builtin') return 'none';
  return 'apiKey';
}

function buildBuiltinToolMetadata(toolData: BuiltinTool) {
  const canonicalId = toolData.id;
  const identity = parseToolIdentity(canonicalId);
  const provider = identity.provider;
  const executionChannel = identity.executionChannel;
  const namespace = identity.namespace;
  const { resource, action } = inferResourceAndAction(canonicalId);
  return {
    canonicalId,
    provider,
    executionChannel,
    toolkitId: identity.toolkitId,
    namespace,
    resource,
    action,
    capabilitySet: [toolData.category.toLowerCase().replace(/\s+/g, '_')],
    tags: [namespace, provider, executionChannel, identity.toolkit],
    status: 'active' as const,
    deprecated: false,
    aliases: canonicalId === toolData.id ? [] : [toolData.id],
    inputSchema: toolData.implementation?.parameters || {},
    outputSchema: {},
  };
}

async function upsertToolkit(toolkitData: {
  id: string;
  provider: string;
  executionChannel?: string;
  namespace: string;
  toolkit?: string;
  name: string;
  description?: string;
}): Promise<void> {
  await ToolkitModel.updateOne(
    { id: toolkitData.id },
    {
      $set: {
        provider: toolkitData.provider,
        executionChannel: toolkitData.executionChannel,
        namespace: toolkitData.namespace,
        name: toolkitData.name,
        description: toolkitData.description || '',
        version: 'v1',
        status: 'active',
        authStrategy: inferToolkitAuthStrategy(
          toolkitData.provider,
          toolkitData.namespace,
          toolkitData.toolkit,
        ),
        metadata: {
          source: 'tool-registry',
          toolkit: toolkitData.toolkit || '',
        },
      },
      $setOnInsert: {
        id: toolkitData.id,
      },
    },
    { upsert: true },
  ).exec();
}

async function alignStoredToolMetadata(dryRun: boolean): Promise<number> {
  const tools = await ToolModel.find()
    .select({
      id: 1,
      canonicalId: 1,
      provider: 1,
      executionChannel: 1,
      namespace: 1,
      toolkitId: 1,
      resource: 1,
      action: 1,
    })
    .lean()
    .exec();

  let updated = 0;
  for (const tool of tools as any[]) {
    const toolId = String(tool.canonicalId || tool.id || '').trim();
    if (!toolId) continue;
    const identity = parseToolIdentity(toolId);
    const update: Record<string, unknown> = {};
    if (String(tool.provider || '') !== identity.provider) update.provider = identity.provider;
    if (String(tool.executionChannel || '') !== identity.executionChannel) {
      update.executionChannel = identity.executionChannel;
    }
    if (String(tool.namespace || '') !== identity.namespace) update.namespace = identity.namespace;
    if (String(tool.toolkitId || '') !== identity.toolkitId) update.toolkitId = identity.toolkitId;
    if (String(tool.resource || '') !== identity.resource) update.resource = identity.resource;
    if (String(tool.action || '') !== identity.action) update.action = identity.action;
    if (!Object.keys(update).length) continue;
    updated += 1;
    if (!dryRun) {
      await ToolModel.updateOne({ _id: tool._id }, { $set: update }).exec();
    }
  }

  return updated;
}

async function syncToolkitsFromTools(
  mode: SeedMode,
  dryRun: boolean,
): Promise<{ toolkitsTouched: number; deprecatedInSync: number }> {
  const tools = await ToolModel.find({ enabled: { $ne: false } })
    .select({ id: 1, canonicalId: 1 })
    .lean()
    .exec();

  const toolkitMap = new Map<
    string,
    {
      id: string;
      provider: string;
      executionChannel: string;
      namespace: string;
      toolkit: string;
    }
  >();

  for (const tool of tools as any[]) {
    const toolId = String(tool.canonicalId || tool.id || '').trim();
    const identity = parseToolIdentity(toolId);
    if (!identity.toolkitId || !identity.provider || !identity.namespace) continue;
    toolkitMap.set(identity.toolkitId, {
      id: identity.toolkitId,
      provider: identity.provider,
      executionChannel: identity.executionChannel,
      namespace: identity.namespace,
      toolkit: identity.toolkit,
    });
  }

  for (const toolkit of toolkitMap.values()) {
    if (dryRun) continue;
    await upsertToolkit({
      id: toolkit.id,
      provider: toolkit.provider,
      executionChannel: toolkit.executionChannel,
      namespace: toolkit.namespace,
      toolkit: toolkit.toolkit,
      name: getToolkitDisplayName(toolkit.toolkit),
      description: `Toolkit for ${toolkit.namespace}/${toolkit.toolkit} (${toolkit.provider})`,
    });
  }

  let deprecatedInSync = 0;
  if (mode === 'sync') {
    const activeToolkitIds = Array.from(toolkitMap.keys());
    const staleQuery = activeToolkitIds.length
      ? { id: { $nin: activeToolkitIds } }
      : {};

    if (dryRun) {
      deprecatedInSync = await ToolkitModel.countDocuments(staleQuery).exec();
    } else {
      const result = await ToolkitModel.updateMany(staleQuery, {
        $set: { status: 'deprecated' },
      }).exec();
      deprecatedInSync = Number(result.modifiedCount || 0);
    }
  }

  return {
    toolkitsTouched: toolkitMap.size,
    deprecatedInSync,
  };
}

function parseArgs(argv: string[]): { mode: SeedMode; dryRun: boolean } {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  const modeRaw = modeArg
    ? modeArg.replace('--mode=', '').trim().toLowerCase()
    : 'sync';
  if (modeRaw && !['sync', 'append'].includes(modeRaw)) {
    throw new Error(`Unsupported seed mode: ${modeRaw}`);
  }
  return {
    mode: modeRaw === 'append' ? 'append' : 'sync',
    dryRun: argv.includes('--dry-run'),
  };
}

export async function seedBuiltinTools(
  mode: SeedMode = 'sync',
  options?: { dryRun?: boolean },
): Promise<{
  mode: SeedMode;
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  metadataAligned: number;
  toolkitsTouched: number;
}> {
  bootstrapEnv();
  const dryRun = options?.dryRun === true;
  await mongoose.connect(getMongoUri());

  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    if (mode === 'sync') {
      if (dryRun) {
        const virtualCount = await ToolModel.countDocuments({
          id: { $in: VIRTUAL_TOOL_IDS },
        }).exec();
        const deprecatedCount = await ToolModel.countDocuments({
          id: { $in: DEPRECATED_TOOL_IDS },
        }).exec();
        console.log(
          `[seed:builtin-tools] dry-run stale tools: virtual=${virtualCount}, deprecated=${deprecatedCount}`,
        );
      } else {
        await ToolModel.deleteMany({ id: { $in: VIRTUAL_TOOL_IDS } }).exec();
        await ToolModel.deleteMany({ id: { $in: DEPRECATED_TOOL_IDS } }).exec();
      }
    }

    for (const toolData of BUILTIN_TOOLS) {
      const metadata = buildBuiltinToolMetadata(toolData);
      const existingTool = await ToolModel.findOne({ id: toolData.id }).exec();

      if (!existingTool) {
        created += 1;
        if (!dryRun) {
          await new ToolModel({
            ...toolData,
            ...metadata,
            enabled: true,
          }).save();
          await upsertToolkit({
            id: metadata.toolkitId,
            provider: metadata.provider,
            executionChannel: metadata.executionChannel,
            namespace: metadata.namespace,
            toolkit: inferToolkitFromToolId(metadata.canonicalId),
            name: getToolkitDisplayName(
              inferToolkitFromToolId(metadata.canonicalId),
            ),
            description: `Toolkit for ${metadata.namespace}/${inferToolkitFromToolId(
              metadata.canonicalId,
            )} (${metadata.provider})`,
          });
        }
        continue;
      }

      if (mode === 'append') {
        skipped += 1;
        continue;
      }

      updated += 1;
      if (!dryRun) {
        await ToolModel.updateOne(
          { id: toolData.id },
          {
            $set: {
              ...metadata,
              name: toolData.name,
              description: toolData.description,
              prompt: toolData.prompt,
              type: toolData.type,
              category: toolData.category,
              requiredPermissions: toolData.requiredPermissions,
              tokenCost: toolData.tokenCost,
              implementation: toolData.implementation,
              enabled: true,
            },
          },
        ).exec();

        await upsertToolkit({
          id: metadata.toolkitId,
          provider: metadata.provider,
          executionChannel: metadata.executionChannel,
          namespace: metadata.namespace,
          toolkit: inferToolkitFromToolId(metadata.canonicalId),
          name: getToolkitDisplayName(inferToolkitFromToolId(metadata.canonicalId)),
          description: `Toolkit for ${metadata.namespace}/${inferToolkitFromToolId(
            metadata.canonicalId,
          )} (${metadata.provider})`,
        });
      }
    }

    const metadataAligned =
      mode === 'sync' ? await alignStoredToolMetadata(dryRun) : 0;
    const toolkitSync = await syncToolkitsFromTools(mode, dryRun);

    const implementedToolIds = new Set(IMPLEMENTED_TOOL_IDS);
    const missingImplementations = BUILTIN_TOOLS.map((tool) => tool.id).filter(
      (toolId) => !implementedToolIds.has(toolId),
    );
    if (missingImplementations.length) {
      console.error(
        `[seed:builtin-tools] missing implementation: ${missingImplementations.join(', ')}`,
      );
    }

    const persistedBuiltIns = await ToolModel.find({
      'implementation.type': 'built_in',
    })
      .select({ id: 1, _id: 0 })
      .lean()
      .exec();
    const unresolvedPersisted = persistedBuiltIns
      .map((tool) => String((tool as any).id || '').trim())
      .filter(Boolean)
      .filter((toolId) => !implementedToolIds.has(toolId));
    if (unresolvedPersisted.length) {
      console.warn(
        `[seed:builtin-tools] persisted built-in without implementation: ${unresolvedPersisted.join(', ')}`,
      );
    }

    return {
      mode,
      dryRun,
      created,
      updated,
      skipped,
      metadataAligned,
      toolkitsTouched: toolkitSync.toolkitsTouched,
    };
  } finally {
    await mongoose.disconnect();
  }
}

async function run(): Promise<void> {
  const { mode, dryRun } = parseArgs(process.argv.slice(2));
  const result = await seedBuiltinTools(mode, { dryRun });
  console.log(
    `[seed:builtin-tools] mode=${result.mode} dryRun=${result.dryRun} created=${result.created} updated=${result.updated} skipped=${result.skipped} metadataAligned=${result.metadataAligned} toolkits=${result.toolkitsTouched}`,
  );
}

if (require.main === module) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[seed:builtin-tools] failed: ${message}`);
    process.exit(1);
  });
}
