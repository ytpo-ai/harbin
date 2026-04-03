import mongoose, { Schema } from 'mongoose';
import { bootstrapEnv, getMongoUri } from '../shared/env-loader';

type SkillDoc = {
  id: string;
  slug: string;
  planningRules?: unknown;
};

const skillSchema = new Schema(
  {
    id: { type: String, required: true },
    slug: { type: String, required: true },
    planningRules: { type: [Object], default: [] },
  },
  { timestamps: true, collection: 'agent_skills', strict: false },
);

const SkillModel = mongoose.model<SkillDoc>('SkillUnsetPlanningRulesMigration', skillSchema);

async function run(): Promise<void> {
  bootstrapEnv();
  const dryRun = process.argv.includes('--dry-run');
  const mongoUri = getMongoUri();

  console.log(`[unset-skill-planning-rules] Connecting to ${mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);
  await mongoose.connect(mongoUri);

  try {
    const filter = { planningRules: { $exists: true } };
    const total = await SkillModel.countDocuments(filter).exec();
    console.log(`[unset-skill-planning-rules] Matched skills=${total}`);

    if (dryRun) {
      const sample = await SkillModel.find(filter, { id: 1, slug: 1 }).limit(20).lean().exec();
      for (const item of sample) {
        console.log(`[dry-run] skill id=${item.id} slug=${item.slug}`);
      }
      console.log('[unset-skill-planning-rules] DRY RUN - no changes made');
      return;
    }

    const result = await SkillModel.updateMany(filter, {
      $unset: { planningRules: '' },
      $set: { updatedAt: new Date() },
    }).exec();

    console.log(
      `[unset-skill-planning-rules] Done matched=${result.matchedCount} modified=${result.modifiedCount}`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[unset-skill-planning-rules] failed: ${message}`);
  process.exit(1);
});
