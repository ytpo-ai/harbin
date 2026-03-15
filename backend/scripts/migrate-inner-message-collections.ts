import mongoose from 'mongoose';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

type Options = {
  dryRun: boolean;
};

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
    console.log(`[migrate-inner-message] skip: source collection not found: ${oldName}`);
    return;
  }

  if (newExists) {
    console.log(`[migrate-inner-message] skip: target collection already exists: ${newName}`);
    return;
  }

  if (dryRun) {
    console.log(`[migrate-inner-message][dry-run] rename ${oldName} -> ${newName}`);
    return;
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection not ready');
  }

  await db.collection(oldName).rename(newName);
  console.log(`[migrate-inner-message] renamed ${oldName} -> ${newName}`);
}

async function run(): Promise<void> {
  bootstrapEnv();
  const { dryRun } = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agent-team';

  await mongoose.connect(mongoUri);
  try {
    await renameCollection('agent_collaboration_messages', 'inner_messages', dryRun);
    await renameCollection('agent_message_subscriptions', 'inner_message_subscriptions', dryRun);
  } finally {
    await mongoose.disconnect();
  }

  console.log(`[migrate-inner-message] finished dryRun=${dryRun}`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate-inner-message] failed: ${message}`);
  process.exit(1);
});
