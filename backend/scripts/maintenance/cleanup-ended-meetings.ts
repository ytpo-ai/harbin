/**
 * cleanup-ended-meetings.ts — Delete ended meetings from MongoDB.
 *
 * Usage:
 *   ts-node scripts/maintenance/cleanup-ended-meetings.ts
 *   ts-node scripts/maintenance/cleanup-ended-meetings.ts --older-than-hours=168
 *   ts-node scripts/maintenance/cleanup-ended-meetings.ts --execute --confirm=DELETE_ENDED_MEETINGS
 */

import mongoose from 'mongoose';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';

const REQUIRED_CONFIRM = 'DELETE_ENDED_MEETINGS';

interface CleanupEndedMeetingsOptions {
  dryRun: boolean;
  execute: boolean;
  confirm?: string;
  olderThanHours?: number;
}

export function parseArgs(argv: string[]): CleanupEndedMeetingsOptions {
  const execute = argv.includes('--execute');
  const dryRun = !execute || argv.includes('--dry-run');
  const confirmArg = argv.find((arg) => arg.startsWith('--confirm='));
  const olderThanHoursArg = argv.find((arg) => arg.startsWith('--older-than-hours='));

  let olderThanHours: number | undefined;
  if (olderThanHoursArg) {
    const raw = olderThanHoursArg.replace('--older-than-hours=', '').trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error('--older-than-hours must be a non-negative number');
    }
    olderThanHours = parsed;
  }

  return {
    dryRun,
    execute,
    confirm: confirmArg ? confirmArg.replace('--confirm=', '').trim() : undefined,
    olderThanHours,
  };
}

function buildDeleteFilter(olderThanHours?: number): Record<string, unknown> {
  const filter: Record<string, unknown> = { status: 'ended' };
  if (olderThanHours !== undefined) {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    filter.endedAt = { $lte: cutoff };
  }
  return filter;
}

export async function run(argv?: string[]): Promise<void> {
  bootstrapEnv();
  const options = parseArgs(argv || process.argv.slice(2));

  if (options.execute && options.confirm !== REQUIRED_CONFIRM) {
    throw new Error(`Missing required confirmation. Use --confirm=${REQUIRED_CONFIRM}`);
  }

  const mongoUri = getMongoUri();
  await mongoose.connect(mongoUri);

  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('MongoDB connection not ready');
    }

    const meetings = db.collection('meetings');
    const filter = buildDeleteFilter(options.olderThanHours);
    const matched = await meetings.countDocuments(filter);

    console.log(`[cleanup-ended-meetings] mode=${options.dryRun ? 'dry-run' : 'execute'}`);
    console.log(`[cleanup-ended-meetings] olderThanHours=${options.olderThanHours ?? '<none>'}`);
    console.log(`[cleanup-ended-meetings] matched meetings: ${matched}`);

    if (options.dryRun) {
      console.log('[cleanup-ended-meetings] dry-run finished, no meetings deleted');
      return;
    }

    const result = await meetings.deleteMany(filter);
    console.log(`[cleanup-ended-meetings] deleted meetings: ${result.deletedCount || 0}`);
    console.log('[cleanup-ended-meetings] execute finished');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cleanup-ended-meetings] failed: ${message}`);
    process.exit(1);
  });
}
