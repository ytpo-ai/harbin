import mongoose from 'mongoose';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';

const COLLECTION_NAME = 'agent_memo_versions';

function parseArgs(argv: string[]): { dryRun: boolean } {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

async function dropCollection(options: { dryRun: boolean }): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not ready');
  }

  const collections = await db.listCollections({ name: COLLECTION_NAME }).toArray();
  const exists = collections.length > 0;

  if (!exists) {
    console.log(`[migrate:drop-agent-memo-versions] collection ${COLLECTION_NAME} not found`);
    return;
  }

  const documentCount = await db.collection(COLLECTION_NAME).countDocuments({});
  if (options.dryRun) {
    console.log(
      `[migrate:drop-agent-memo-versions] dryRun=true collection=${COLLECTION_NAME} documents=${documentCount} action=skip_drop`,
    );
    return;
  }

  await db.dropCollection(COLLECTION_NAME);
  console.log(
    `[migrate:drop-agent-memo-versions] dropped collection=${COLLECTION_NAME} documents=${documentCount}`,
  );
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  bootstrapEnv();
  await mongoose.connect(getMongoUri());

  try {
    await dropCollection(options);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate:drop-agent-memo-versions] failed: ${message}`);
  process.exit(1);
});
