/**
 * cleanup-runtime.ts — Clean up Agent runtime data from MongoDB and Redis.
 *
 * Usage:
 *   ts-node scripts/maintenance/cleanup-runtime.ts                         # dry-run (default)
 *   ts-node scripts/maintenance/cleanup-runtime.ts --execute --confirm=DELETE_RUNTIME_DATA
 */

import mongoose from 'mongoose';
import Redis from 'ioredis';
import { bootstrapEnv, getMongoUri, getRedisUrl } from '../shared/env-loader';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIRED_CONFIRM = 'DELETE_RUNTIME_DATA';

const RUNTIME_COLLECTIONS = [
  'agent_sessions',
  'agent_messages',
  'agent_parts',
  'agent_runs',
  'agent_tasks',
  'agent_action_logs',
  'agent_tool_executions',
  'agent_events_outbox',
] as const;

type RuntimeCollectionName = (typeof RUNTIME_COLLECTIONS)[number];

const REDIS_PATTERNS = ['agent-task:queue', 'agent-task-events:*'];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CleanupOptions {
  dryRun: boolean;
  execute: boolean;
  confirm?: string;
}

export function parseArgs(argv: string[]): CleanupOptions {
  const execute = argv.includes('--execute');
  const dryRun = !execute || argv.includes('--dry-run');
  const confirmArg = argv.find((arg) => arg.startsWith('--confirm='));
  return {
    dryRun,
    execute,
    confirm: confirmArg ? confirmArg.replace('--confirm=', '').trim() : undefined,
  };
}

// ---------------------------------------------------------------------------
// MongoDB helpers
// ---------------------------------------------------------------------------

async function countCollection(name: RuntimeCollectionName): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection not ready');
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (!exists) return 0;
  return db.collection(name).countDocuments();
}

async function deleteCollection(name: RuntimeCollectionName): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection not ready');
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (!exists) return 0;
  const result = await db.collection(name).deleteMany({});
  return Number(result.deletedCount || 0);
}

// ---------------------------------------------------------------------------
// Redis helpers
// ---------------------------------------------------------------------------

async function collectRedisKeys(redis: Redis, patterns: string[]): Promise<string[]> {
  const keySet = new Set<string>();
  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      const exists = await redis.exists(pattern);
      if (exists > 0) keySet.add(pattern);
      continue;
    }
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      keys.forEach((key) => keySet.add(key));
      cursor = nextCursor;
    } while (cursor !== '0');
  }
  return Array.from(keySet);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run(argv?: string[]): Promise<void> {
  bootstrapEnv();
  const options = parseArgs(argv || process.argv.slice(2));

  if (options.execute && options.confirm !== REQUIRED_CONFIRM) {
    throw new Error(`Missing required confirmation. Use --confirm=${REQUIRED_CONFIRM}`);
  }

  const mongoUri = getMongoUri();
  await mongoose.connect(mongoUri);

  const redisUrl = getRedisUrl();
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  await redis.connect();

  try {
    // --- Before counts ---
    const beforeCounts = await Promise.all(
      RUNTIME_COLLECTIONS.map(async (name) => ({
        name,
        count: await countCollection(name),
      })),
    );

    const redisKeys = await collectRedisKeys(redis, REDIS_PATTERNS);

    console.log(`[cleanup-runtime] mode=${options.dryRun ? 'dry-run' : 'execute'}`);
    console.log(`[cleanup-runtime] mongo collections (${RUNTIME_COLLECTIONS.length}):`);
    beforeCounts.forEach(({ name, count }) => {
      console.log(`  ${name}: ${count} docs`);
    });
    console.log(`[cleanup-runtime] redis matched keys: ${redisKeys.length}`);
    if (redisKeys.length > 0) {
      console.log(`[cleanup-runtime] redis key sample: ${redisKeys.slice(0, 10).join(', ')}`);
    }

    if (options.dryRun) {
      console.log('[cleanup-runtime] dry-run finished, no data deleted');
      return;
    }

    // --- Execute deletion ---
    const mongoDeleted = await Promise.all(
      RUNTIME_COLLECTIONS.map(async (name) => ({
        name,
        deleted: await deleteCollection(name),
      })),
    );

    let redisDeleted = 0;
    if (redisKeys.length > 0) {
      redisDeleted = await redis.del(...redisKeys);
    }

    console.log('[cleanup-runtime] deletion results:');
    mongoDeleted.forEach(({ name, deleted }) => {
      console.log(`  ${name}: ${deleted} deleted`);
    });
    console.log(`  redis keys deleted: ${redisDeleted}`);
    console.log('[cleanup-runtime] execute finished');
  } finally {
    await redis.quit();
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cleanup-runtime] failed: ${message}`);
    process.exit(1);
  });
}
