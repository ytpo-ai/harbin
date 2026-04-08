import mongoose, { Schema } from 'mongoose';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';

type SessionUsageAggregate = {
  _id: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

const agentMessageSchema = new Schema({}, { collection: 'agent_messages', strict: false });
const agentSessionSchema = new Schema({}, { collection: 'agent_sessions', strict: false });

const AgentMessageModel = mongoose.model('SessionUsageBackfillMessage', agentMessageSchema);
const AgentSessionModel = mongoose.model('SessionUsageBackfillSession', agentSessionSchema);

function parseArgs(argv: string[]): { dryRun: boolean; resetMissing: boolean } {
  return {
    dryRun: argv.includes('--dry-run'),
    resetMissing: argv.includes('--reset-missing'),
  };
}

async function backfillSessionUsage(options: { dryRun: boolean; resetMissing: boolean }): Promise<void> {
  const pipeline = [
    {
      $match: {
        sessionId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$sessionId',
        totalCost: { $sum: { $ifNull: ['$cost', 0] } },
        inputTokens: { $sum: { $ifNull: ['$tokens.input', 0] } },
        outputTokens: { $sum: { $ifNull: ['$tokens.output', 0] } },
        reasoningTokens: { $sum: { $ifNull: ['$tokens.reasoning', 0] } },
        cacheReadTokens: { $sum: { $ifNull: ['$tokens.cacheRead', 0] } },
        cacheWriteTokens: { $sum: { $ifNull: ['$tokens.cacheWrite', 0] } },
        totalTokens: { $sum: { $ifNull: ['$tokens.total', 0] } },
      },
    },
  ] as const;

  const aggregates = await AgentMessageModel.aggregate<SessionUsageAggregate>(pipeline).exec();
  console.log(`[migrate:session-token-cost] aggregates=${aggregates.length} dryRun=${options.dryRun}`);

  let updated = 0;
  let missingSessions = 0;
  for (const row of aggregates) {
    const update = {
      $set: {
        totalCost: row.totalCost || 0,
        totalTokens: {
          input: row.inputTokens || 0,
          output: row.outputTokens || 0,
          reasoning: row.reasoningTokens || 0,
          cacheRead: row.cacheReadTokens || 0,
          cacheWrite: row.cacheWriteTokens || 0,
          total: row.totalTokens || 0,
        },
      },
    };

    if (options.dryRun) {
      const matchCount = await AgentSessionModel.countDocuments({ id: row._id }).exec();
      if (matchCount > 0) {
        updated += 1;
      } else {
        missingSessions += 1;
      }
      continue;
    }

    const result = await AgentSessionModel.updateOne({ id: row._id }, update).exec();
    if ((result.matchedCount || 0) > 0) {
      updated += 1;
    } else {
      missingSessions += 1;
    }
  }

  let resetCount = 0;
  if (options.resetMissing) {
    const resetUpdate = {
      $set: {
        totalCost: 0,
        totalTokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
    };
    if (!options.dryRun) {
      const result = await AgentSessionModel.updateMany({ id: { $nin: aggregates.map((item) => item._id) } }, resetUpdate).exec();
      resetCount = Number(result.modifiedCount || 0);
    } else {
      resetCount = await AgentSessionModel.countDocuments({ id: { $nin: aggregates.map((item) => item._id) } }).exec();
    }
  }

  console.log(
    `[migrate:session-token-cost] done updated=${updated} missingSessions=${missingSessions} resetMissing=${options.resetMissing ? resetCount : 0} dryRun=${options.dryRun}`,
  );
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  bootstrapEnv();
  await mongoose.connect(getMongoUri());

  try {
    await backfillSessionUsage(options);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate:session-token-cost] failed: ${message}`);
  process.exit(1);
});
