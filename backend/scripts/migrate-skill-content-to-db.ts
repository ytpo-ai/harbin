import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import mongoose, { Schema } from 'mongoose';

type SkillDoc = {
  id: string;
  slug: string;
  name?: string;
  content?: string;
  contentType?: string;
  contentHash?: string;
  contentSize?: number;
  contentUpdatedAt?: Date;
  metadataUpdatedAt?: Date;
  updatedAt?: Date;
};

const DEFAULT_SOURCE_DIR = resolve(__dirname, '../../data/skills/library');

const skillSchema = new Schema(
  {
    id: { type: String, required: true },
    slug: { type: String, required: true },
    name: String,
    content: String,
    contentType: String,
    contentHash: String,
    contentSize: Number,
    contentUpdatedAt: Date,
    metadataUpdatedAt: Date,
  },
  { timestamps: true, collection: 'skills' },
);

const SkillModel = mongoose.model<SkillDoc>('SkillMigration', skillSchema);

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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

function parseArgs(argv: string[]) {
  const sourceArg = argv.find((arg) => arg.startsWith('--source='));
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  return {
    dryRun: argv.includes('--dry-run'),
    sourceDir: sourceArg ? resolve(sourceArg.replace('--source=', '').trim()) : DEFAULT_SOURCE_DIR,
    limit: limitArg ? Math.max(1, Number(limitArg.replace('--limit=', '').trim())) : Number.POSITIVE_INFINITY,
  };
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function run(): Promise<void> {
  bootstrapEnv();
  const { dryRun, sourceDir, limit } = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agent-team';

  if (!existsSync(sourceDir)) {
    throw new Error(`source directory not found: ${sourceDir}`);
  }

  const filenames = readdirSync(sourceDir)
    .filter((name) => name.endsWith('.md'))
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  if (!filenames.length) {
    console.log(`[migrate-skill-content] no markdown files under ${sourceDir}`);
    return;
  }

  await mongoose.connect(mongoUri);
  console.log(`[migrate-skill-content] connected mongodb: ${mongoUri}`);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  try {
    for (const filename of filenames) {
      scanned += 1;
      const slug = filename.replace(/\.md$/, '').trim().toLowerCase();
      const filePath = join(sourceDir, filename);
      const content = readFileSync(filePath, 'utf8').trim();
      if (!content) {
        skipped += 1;
        continue;
      }

      const skill = await SkillModel.findOne({ slug }).exec();
      if (!skill) {
        skipped += 1;
        continue;
      }

      const contentHash = computeHash(content);
      const contentSize = Buffer.byteLength(content, 'utf8');
      const now = new Date();

      if (dryRun) {
        console.log(`[dry-run] slug=${slug} id=${skill.id} hash=${contentHash} size=${contentSize}`);
        continue;
      }

      await SkillModel.updateOne(
        { id: skill.id },
        {
          $set: {
            content,
            contentType: 'text/markdown',
            contentHash,
            contentSize,
            contentUpdatedAt: now,
            updatedAt: now,
          },
        },
      ).exec();
      updated += 1;
    }

    console.log(
      `[migrate-skill-content] done scanned=${scanned} updated=${updated} skipped=${skipped} dryRun=${dryRun}`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate-skill-content] failed: ${message}`);
  process.exit(1);
});
