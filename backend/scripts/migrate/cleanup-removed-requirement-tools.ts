import mongoose, { Schema } from 'mongoose';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';

type ToolBindingRow = {
  _id: unknown;
  tools?: string[];
};

const REMOVED_REQUIREMENT_TOOL_IDS = [
  'builtin.engineering.mcp.requirement.board',
  'builtin.engineering.mcp.requirement.assign',
  'builtin.engineering.mcp.requirement.comment',
  'builtin.engineering.mcp.requirement.mutate',
] as const;

const TOOL_REPLACEMENTS: Record<string, string> = {
  'builtin.engineering.mcp.requirement.board': 'builtin.engineering.mcp.requirement.list',
  'builtin.engineering.mcp.requirement.assign': 'builtin.engineering.mcp.requirement.update',
  'builtin.engineering.mcp.requirement.comment': 'builtin.engineering.mcp.requirement.update',
  'builtin.engineering.mcp.requirement.mutate': 'builtin.engineering.mcp.requirement.update',
};

const toolSchema = new Schema(
  {
    id: String,
    canonicalId: String,
  },
  { collection: 'agent_tools', strict: false },
);

const agentRoleSchema = new Schema(
  {
    tools: [String],
  },
  { collection: 'agent_roles', strict: false },
);

const agentSchema = new Schema(
  {
    tools: [String],
  },
  { collection: 'agents', strict: false },
);

const ToolModel = mongoose.model('RequirementToolCleanupTool', toolSchema);
const AgentRoleModel = mongoose.model<ToolBindingRow>('RequirementToolCleanupAgentRole', agentRoleSchema);
const AgentModel = mongoose.model<ToolBindingRow>('RequirementToolCleanupAgent', agentSchema);

function normalizeToolList(values: string[] | undefined): string[] {
  const normalized = (Array.isArray(values) ? values : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function parseArgs(argv: string[]): { dryRun: boolean } {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

function remapTools(input: string[] | undefined): { nextTools: string[]; changed: boolean } {
  const sourceTools = normalizeToolList(input);
  if (!sourceTools.length) {
    return { nextTools: [], changed: false };
  }

  const next = new Set<string>();
  for (const toolId of sourceTools) {
    if (REMOVED_REQUIREMENT_TOOL_IDS.includes(toolId as (typeof REMOVED_REQUIREMENT_TOOL_IDS)[number])) {
      const replacement = TOOL_REPLACEMENTS[toolId];
      if (replacement) {
        next.add(replacement);
      }
      continue;
    }
    next.add(toolId);
  }

  const nextTools = Array.from(next);
  const changed =
    nextTools.length !== sourceTools.length ||
    nextTools.some((toolId, index) => toolId !== sourceTools[index]);
  return { nextTools, changed };
}

async function cleanupBindings(
  model: mongoose.Model<ToolBindingRow>,
  label: 'agent_roles' | 'agents',
  dryRun: boolean,
): Promise<{ scanned: number; updated: number }> {
  const rows = await model
    .find({ tools: { $in: [...REMOVED_REQUIREMENT_TOOL_IDS] } })
    .select({ _id: 1, tools: 1 })
    .lean()
    .exec();

  let updated = 0;
  for (const row of rows) {
    const { nextTools, changed } = remapTools(row.tools);
    if (!changed) {
      continue;
    }
    updated += 1;
    if (!dryRun) {
      await model.updateOne({ _id: row._id }, { $set: { tools: nextTools } }).exec();
    }
  }

  console.log(`[cleanup:requirement-tools] ${label} scanned=${rows.length} updated=${updated} dryRun=${dryRun}`);
  return { scanned: rows.length, updated };
}

async function run(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  bootstrapEnv();
  await mongoose.connect(getMongoUri());

  try {
    const deleteQuery = {
      $or: [{ id: { $in: [...REMOVED_REQUIREMENT_TOOL_IDS] } }, { canonicalId: { $in: [...REMOVED_REQUIREMENT_TOOL_IDS] } }],
    };

    const removableToolCount = await ToolModel.countDocuments(deleteQuery).exec();
    let deletedTools = 0;
    if (!dryRun && removableToolCount > 0) {
      const result = await ToolModel.deleteMany(deleteQuery).exec();
      deletedTools = Number(result.deletedCount || 0);
    }

    const roleResult = await cleanupBindings(AgentRoleModel, 'agent_roles', dryRun);
    const agentResult = await cleanupBindings(AgentModel, 'agents', dryRun);

    console.log(
      `[cleanup:requirement-tools] done removedTools=${dryRun ? removableToolCount : deletedTools} roleUpdated=${roleResult.updated} agentUpdated=${agentResult.updated} dryRun=${dryRun}`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[cleanup:requirement-tools] failed: ${message}`);
  process.exit(1);
});
