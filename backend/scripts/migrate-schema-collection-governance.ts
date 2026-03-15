import mongoose from 'mongoose';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

type Options = {
  dryRun: boolean;
  rollback: boolean;
};

type RenamePair = {
  oldName: string;
  newName: string;
};

const RENAME_PAIRS: RenamePair[] = [
  { oldName: 'agentprofiles', newName: 'agent_profiles' },
  { oldName: 'toolexecutions', newName: 'agent_tool_executions' },
  { oldName: 'orchestrationschedules', newName: 'orchestration_schedules' },
  { oldName: 'agenttooltokenrevocations', newName: 'agent_tool_token_revocations' },
  { oldName: 'agenttoolcredentials', newName: 'agent_tool_credentials' },
  { oldName: 'orchestrationtasks', newName: 'orchestration_tasks' },
  { oldName: 'apikeys', newName: 'api_keys' },
  { oldName: 'plansessions', newName: 'orchestration_plan_sessions' },
  { oldName: 'rdtasks', newName: 'ei_tasks' },
  { oldName: 'orchestrationplans', newName: 'orchestration_plans' },
  { oldName: 'operationlogs', newName: 'operation_logs' },
  { oldName: 'agentsessions', newName: 'agent_sessions' },
  { oldName: 'agentroles', newName: 'agent_roles' },
  { oldName: 'agentmemoversions', newName: 'agent_memo_versions' },
  { oldName: 'skills', newName: 'agent_skills' },
  { oldName: 'agentmemos', newName: 'agent_memos' },
  { oldName: 'engineeringrepositories', newName: 'ei_repositories' },
  { oldName: 'tools', newName: 'agent_tools' },
  { oldName: 'toolkits', newName: 'agent_toolkits' },
  { oldName: 'model_registry', newName: 'agent_model_registry' },
  { oldName: 'messages', newName: 'chats' },
];

const UNCHANGED_COLLECTIONS = [
  'agents',
  'inner_messages',
  'inner_message_subscriptions',
  'ei_projects',
  'system_messages',
  'tasks',
  'employees',
  'invitations',
  'meetings',
  'agent_action_logs',
  'agent_runs',
  'agent_parts',
  'agent_messages',
  'agent_events_outbox',
  'agent_runtime_maintenance_audits',
  'ei_requirements',
  'ei_project_statistics_snapshots',
  'ei_opencode_run_analytics',
  'ei_opencode_event_facts',
  'ei_opencode_run_sync_batches',
] as const;

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

function parseArgs(argv: string[]): Options {
  return {
    dryRun: argv.includes('--dry-run'),
    rollback: argv.includes('--rollback'),
  };
}

async function collectionExists(name: string): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  const rows = await db.listCollections({ name }).toArray();
  return rows.length > 0;
}

async function renameCollection(oldName: string, newName: string, dryRun: boolean): Promise<void> {
  const oldExists = await collectionExists(oldName);
  const newExists = await collectionExists(newName);

  if (!oldExists) {
    console.log(`[schema-governance] skip rename: source collection not found: ${oldName}`);
    return;
  }

  if (newExists) {
    console.log(`[schema-governance] skip rename: target collection already exists: ${newName}`);
    return;
  }

  if (dryRun) {
    console.log(`[schema-governance][dry-run] rename ${oldName} -> ${newName}`);
    return;
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection not ready');
  }

  await db.collection(oldName).rename(newName);
  console.log(`[schema-governance] renamed ${oldName} -> ${newName}`);
}

async function removeOrganizationIdField(collectionName: string, dryRun: boolean): Promise<void> {
  const exists = await collectionExists(collectionName);
  if (!exists) {
    console.log(`[schema-governance] skip unset: collection not found: ${collectionName}`);
    return;
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection not ready');
  }

  const collection = db.collection(collectionName);
  const count = await collection.countDocuments({ organizationId: { $exists: true } });
  if (count === 0) {
    console.log(`[schema-governance] skip unset: no organizationId in ${collectionName}`);
    return;
  }

  if (dryRun) {
    console.log(`[schema-governance][dry-run] unset organizationId in ${collectionName}, matched=${count}`);
    return;
  }

  const result = await collection.updateMany(
    { organizationId: { $exists: true } },
    { $unset: { organizationId: '' } },
  );

  console.log(
    `[schema-governance] unset organizationId in ${collectionName}, matched=${result.matchedCount}, modified=${result.modifiedCount}`,
  );
}

function getRenamePairs(rollback: boolean): RenamePair[] {
  if (!rollback) return RENAME_PAIRS;
  return RENAME_PAIRS.map((pair) => ({ oldName: pair.newName, newName: pair.oldName }));
}

function getCollectionsForUnset(rollback: boolean): string[] {
  const mappedNames = rollback
    ? RENAME_PAIRS.map((pair) => pair.oldName)
    : RENAME_PAIRS.map((pair) => pair.newName);

  return Array.from(new Set([...mappedNames, ...UNCHANGED_COLLECTIONS]));
}

async function run(): Promise<void> {
  bootstrapEnv();
  const { dryRun, rollback } = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agent-team';

  await mongoose.connect(mongoUri);
  try {
    for (const pair of getRenamePairs(rollback)) {
      await renameCollection(pair.oldName, pair.newName, dryRun);
    }

    for (const collectionName of getCollectionsForUnset(rollback)) {
      await removeOrganizationIdField(collectionName, dryRun);
    }
  } finally {
    await mongoose.disconnect();
  }

  console.log(`[schema-governance] finished dryRun=${dryRun} rollback=${rollback}`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[schema-governance] failed: ${message}`);
  process.exit(1);
});
