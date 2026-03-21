/**
 * cleanup-redis.ts — Audit and clean Redis cache keys.
 *
 * Usage:
 *   ts-node scripts/maintenance/cleanup-redis.ts                                    # dry-run (default)
 *   ts-node scripts/maintenance/cleanup-redis.ts --execute --confirm=FLUSH_REDIS_CACHE
 *   ts-node scripts/maintenance/cleanup-redis.ts --only=agent-task,agent-task-events # clean specific prefixes
 *   ts-node scripts/maintenance/cleanup-redis.ts --keep=skill,inner                 # preserve specific prefixes
 */

import Redis from 'ioredis';
import { bootstrapEnv, getRedisUrl } from '../shared/env-loader';

// ---------------------------------------------------------------------------
// Known business prefix categories
// ---------------------------------------------------------------------------

const KNOWN_PREFIXES: { prefix: string; source: string; description: string }[] = [
  { prefix: 'agent-task:', source: 'agent-executor', description: 'Task queue' },
  { prefix: 'agent-task-events:', source: 'agent-executor', description: 'Task event streams' },
  { prefix: 'inner:subscription:', source: 'inner-message', description: 'Internal message subscription index' },
  { prefix: 'inner:event:def:', source: 'inner-message', description: 'Event definition cache' },
  { prefix: 'skill:', source: 'skill-service', description: 'Skill cache' },
  { prefix: 'ctx-fp:', source: 'context-fingerprint', description: 'Context fingerprint cache' },
  { prefix: 'docs-heat:', source: 'docs-heat', description: 'Docs heat ranking cache' },
  { prefix: 'ei-config:', source: 'ei-app-config', description: 'EI app config cache' },
  { prefix: 'meeting:', source: 'meeting-service', description: 'Meeting state cache' },
];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CleanupRedisOptions {
  dryRun: boolean;
  execute: boolean;
  confirm?: string;
  keep: string[];
  only: string[];
}

export function parseArgs(argv: string[]): CleanupRedisOptions {
  const execute = argv.includes('--execute');
  const dryRun = !execute || argv.includes('--dry-run');
  const confirmArg = argv.find((arg) => arg.startsWith('--confirm='));
  const keepArg = argv.find((arg) => arg.startsWith('--keep='));
  const onlyArg = argv.find((arg) => arg.startsWith('--only='));

  return {
    dryRun,
    execute,
    confirm: confirmArg ? confirmArg.replace('--confirm=', '').trim() : undefined,
    keep: keepArg
      ? keepArg
          .replace('--keep=', '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    only: onlyArg
      ? onlyArg
          .replace('--only=', '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyKey(key: string): string {
  for (const { prefix } of KNOWN_PREFIXES) {
    if (key.startsWith(prefix)) return prefix;
  }
  return '<unknown>';
}

function matchesFilter(prefix: string, only: string[], keep: string[]): boolean {
  // Normalize prefix for matching (strip trailing colon)
  const bare = prefix.replace(/:$/, '');

  if (only.length > 0) {
    return only.some((o) => bare === o || bare.startsWith(o));
  }
  if (keep.length > 0) {
    return !keep.some((k) => bare === k || bare.startsWith(k));
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const REQUIRED_CONFIRM = 'FLUSH_REDIS_CACHE';

export async function run(argv?: string[]): Promise<void> {
  bootstrapEnv();
  const options = parseArgs(argv || process.argv.slice(2));

  if (options.execute && options.confirm !== REQUIRED_CONFIRM) {
    throw new Error(`Missing required confirmation. Use --confirm=${REQUIRED_CONFIRM}`);
  }

  const redisUrl = getRedisUrl();
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  await redis.connect();

  try {
    // --- SCAN all keys ---
    const buckets = new Map<string, string[]>();
    let totalKeys = 0;

    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'COUNT', 500);
      for (const key of keys) {
        totalKeys++;
        const prefix = classifyKey(key);
        const arr = buckets.get(prefix) || [];
        arr.push(key);
        buckets.set(prefix, arr);
      }
      cursor = nextCursor;
    } while (cursor !== '0');

    // --- Report ---
    console.log(`[cleanup-redis] mode=${options.dryRun ? 'dry-run' : 'execute'}`);
    console.log(`[cleanup-redis] total keys scanned: ${totalKeys}`);
    console.log('[cleanup-redis] key distribution:');

    const sortedPrefixes = Array.from(buckets.entries()).sort((a, b) => b[1].length - a[1].length);
    for (const [prefix, keys] of sortedPrefixes) {
      const known = KNOWN_PREFIXES.find((kp) => kp.prefix === prefix);
      const label = known ? `${prefix} (${known.source} — ${known.description})` : prefix;
      const willDelete = matchesFilter(prefix, options.only, options.keep);
      console.log(`  ${label}: ${keys.length} keys ${willDelete ? '[will delete]' : '[keep]'}`);
    }

    if (options.dryRun) {
      console.log('[cleanup-redis] dry-run finished, no keys deleted');
      return;
    }

    // --- Execute deletion ---
    let totalDeleted = 0;
    for (const [prefix, keys] of sortedPrefixes) {
      if (!matchesFilter(prefix, options.only, options.keep)) continue;
      if (keys.length === 0) continue;

      // Delete in batches of 500
      for (let i = 0; i < keys.length; i += 500) {
        const batch = keys.slice(i, i + 500);
        const deleted = await redis.del(...batch);
        totalDeleted += deleted;
      }
      console.log(`[cleanup-redis] deleted ${keys.length} keys with prefix ${prefix}`);
    }

    console.log(`[cleanup-redis] total deleted: ${totalDeleted}`);
    console.log('[cleanup-redis] execute finished');
  } finally {
    await redis.quit();
  }
}

if (require.main === module) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cleanup-redis] failed: ${message}`);
    process.exit(1);
  });
}
