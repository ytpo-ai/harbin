import mongoose from 'mongoose';
import Redis from 'ioredis';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

type CleanupOptions = {
  dryRun: boolean;
  execute: boolean;
  confirm?: string;
  queueKey: string;
  redisPatterns: string[];
};

const REQUIRED_CONFIRM = 'DELETE_AGENT_RUNTIME_DATA';
const RUNTIME_COLLECTIONS = ['agent_sessions', 'agent_messages', 'agent_parts'] as const;

type RuntimeCollectionName = (typeof RUNTIME_COLLECTIONS)[number];

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

function parseArgs(argv: string[]): CleanupOptions {
  const execute = argv.includes('--execute');
  const dryRun = !execute || argv.includes('--dry-run');
  const confirmArg = argv.find((arg) => arg.startsWith('--confirm='));
  const queueArg = argv.find((arg) => arg.startsWith('--queue-key='));
  const patternsArg = argv.find((arg) => arg.startsWith('--redis-patterns='));

  const queueKey = queueArg
    ? String(queueArg.replace('--queue-key=', '')).trim()
    : String(process.env.AGENT_TASK_QUEUE_KEY || 'agent-task:queue').trim();

  const redisPatternsFromArgs = patternsArg
    ? patternsArg
        .replace('--redis-patterns=', '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  const redisPatterns = redisPatternsFromArgs.length
    ? redisPatternsFromArgs
    : [
        queueKey,
        'agent-task-events:*',
      ];

  return {
    dryRun,
    execute,
    confirm: confirmArg ? confirmArg.replace('--confirm=', '').trim() : undefined,
    queueKey,
    redisPatterns,
  };
}

function getRedisUrl(): string {
  const password = process.env.REDIS_PASSWORD || '';
  const db = process.env.REDIS_DB || '0';

  const rawUrl = process.env.REDIS_URL;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!parsed.password && password) {
        parsed.password = password;
      }
      if (!parsed.pathname || parsed.pathname === '/') {
        parsed.pathname = `/${db}`;
      }
      return parsed.toString();
    } catch {
      // fallback
    }
  }

  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT || '6379';
  const authPart = password ? `:${encodeURIComponent(password)}@` : '';
  return `redis://${authPart}${host}:${port}/${db}`;
}

async function countCollection(name: RuntimeCollectionName, query: Record<string, unknown>): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection not ready');
  }
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (!exists) return 0;
  return db.collection<Record<string, unknown>>(name).countDocuments(query as any);
}

async function deleteCollection(name: RuntimeCollectionName, query: Record<string, unknown>): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection not ready');
  }
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (!exists) return 0;
  const result = await db.collection<Record<string, unknown>>(name).deleteMany(query as any);
  return Number(result.deletedCount || 0);
}

async function collectRedisKeys(redis: Redis, patterns: string[]): Promise<string[]> {
  const keySet = new Set<string>();

  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      const exists = await redis.exists(pattern);
      if (exists > 0) {
        keySet.add(pattern);
      }
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

async function run(): Promise<void> {
  bootstrapEnv();
  const options = parseArgs(process.argv.slice(2));

  if (options.execute && options.confirm !== REQUIRED_CONFIRM) {
    throw new Error(`Missing required confirmation. Use --confirm=${REQUIRED_CONFIRM}`);
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agent-team';
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
    const mongoQuery: Record<string, unknown> = {};

    const beforeCounts = await Promise.all(
      RUNTIME_COLLECTIONS.map(async (name) => ({
        name,
        count: await countCollection(name, mongoQuery),
      })),
    );

    const redisKeys = await collectRedisKeys(redis, options.redisPatterns);

    console.log('[cleanup] mode=' + (options.dryRun ? 'dry-run' : 'execute'));
    console.log('[cleanup] mongo collections=' + RUNTIME_COLLECTIONS.join(','));
    beforeCounts.forEach(({ name, count }) => {
      console.log(`[cleanup] mongo count before ${name}=${count}`);
    });
    console.log(`[cleanup] redis queueKey=${options.queueKey}`);
    console.log(`[cleanup] redis patterns=${options.redisPatterns.join(',')}`);
    console.log(`[cleanup] redis matched keys=${redisKeys.length}`);
    if (redisKeys.length > 0) {
      console.log(`[cleanup] redis key sample=${redisKeys.slice(0, 10).join(',')}`);
    }

    if (options.dryRun) {
      console.log('[cleanup] dry-run finished, no data deleted');
      return;
    }

    const mongoDeleted = await Promise.all(
      RUNTIME_COLLECTIONS.map(async (name) => ({
        name,
        deleted: await deleteCollection(name, mongoQuery),
      })),
    );

    let redisDeleted = 0;
    if (redisKeys.length > 0) {
      redisDeleted = await redis.del(...redisKeys);
    }

    mongoDeleted.forEach(({ name, deleted }) => {
      console.log(`[cleanup] mongo deleted ${name}=${deleted}`);
    });
    console.log(`[cleanup] redis deleted=${redisDeleted}`);
    console.log('[cleanup] execute finished');
  } finally {
    await redis.quit();
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[cleanup] failed: ${message}`);
  process.exit(1);
});
