/**
 * Prompt 全量导入脚本
 * 从 data/repos/agency-agents 读取所有 .md 文件，
 * 生成 prompt templates 并写入 MongoDB（prompt_templates + prompt_template_audits）
 *
 * 逻辑等价于: repo-writer(git-clone) -> repo-read(遍历) -> save-prompt-template(批量写入)
 *
 * Usage: cd backend && pnpm exec node scripts/import-agency-agents-prompts.mjs
 */

import mongoose from 'mongoose';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──────────────────────────────────────────────────────────────────
const MONGODB_URI = 'mongodb://admin:goodluck%40123@127.0.0.1:27017/mait?authSource=admin';
const REPO_ROOT = path.resolve(__dirname, '..', '..', 'data', 'repos', 'agency-agents');
const REPO_URL = 'https://github.com/msitarzewski/agency-agents';
const CATEGORY = 'recruitment';
const AUTO_PUBLISH = true;
const BATCH_SIZE = 20;
const OPERATOR_ID = 'mcp.prompt-registry.save-template';
const RECRUITMENT_ROLE_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;

// ── Mongoose Schemas (minimal, matching the app) ────────────────────────────

const promptTemplateSchema = new mongoose.Schema(
  {
    scene: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    version: { type: Number, required: true, min: 1 },
    status: { type: String, required: true, enum: ['draft', 'published', 'archived'], default: 'draft' },
    content: { type: String, required: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true },
    tags: { type: [String], default: undefined },
    source: {
      type: {
        type: String,
        enum: ['github', 'manual', 'internal'],
      },
      repo: { type: String, trim: true },
      path: { type: String, trim: true },
      importedAt: Date,
    },
    updatedBy: { type: String, trim: true },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'prompt_templates', timestamps: false, _id: true },
);

const promptTemplateAuditSchema = new mongoose.Schema(
  {
    scene: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    action: { type: String, required: true, enum: ['create_draft', 'publish', 'unpublish', 'rollback'] },
    version: { type: Number, required: true, min: 1 },
    fromVersion: { type: Number, min: 1 },
    operatorId: { type: String, trim: true },
    summary: { type: String, trim: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'prompt_template_audits', timestamps: false, _id: true },
);

const PromptTemplate = mongoose.model('PromptTemplate', promptTemplateSchema);
const PromptTemplateAudit = mongoose.model('PromptTemplateAudit', promptTemplateAuditSchema);

// ── Helpers ─────────────────────────────────────────────────────────────────

async function findMdFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.github') continue;
      files.push(...(await findMdFiles(fullPath, base)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const relativePath = path.relative(base, fullPath);
      files.push({ fullPath, relativePath });
    }
  }
  return files;
}

function deriveDomain(relativePath) {
  const parts = relativePath.split(path.sep);
  if (parts.length <= 1) return 'general';
  return parts[0].toLowerCase();
}

function derivePersonaRole(relativePath) {
  const domain = deriveDomain(relativePath);
  const filename = path.basename(relativePath, '.md');
  const normalized = filename
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const domainPrefix = `${domain}-`;
  if (normalized.startsWith(domainPrefix) && normalized.length > domainPrefix.length) {
    return normalized.slice(domainPrefix.length);
  }

  return normalized;
}

function buildRole(relativePath) {
  const domain = deriveDomain(relativePath);
  const persona = derivePersonaRole(relativePath);
  return `${domain}:${persona}`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Prompt 全量导入: agency-agents → prompt_templates');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Repo:        ${REPO_URL}`);
  console.log(`  Local:       ${REPO_ROOT}`);
  console.log(`  Category:    ${CATEGORY}`);
  console.log('  Scene:       derive from top-level folder');
  console.log(`  AutoPublish: ${AUTO_PUBLISH}`);
  console.log(`  BatchSize:   ${BATCH_SIZE}`);
  console.log('');

  // 1. Enumerate all .md files
  console.log('[1/4] Scanning .md files...');
  const mdFiles = await findMdFiles(REPO_ROOT);
  mdFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  console.log(`  Found ${mdFiles.length} .md files`);

  // 2. Read all file contents and build template payloads
  console.log('[2/4] Reading file contents and building payloads...');
  const templates = [];
  const readErrors = [];

  for (const file of mdFiles) {
    try {
      const content = await readFile(file.fullPath, 'utf8');
      const trimmed = content.trim();
      if (!trimmed) {
        readErrors.push({ path: file.relativePath, error: 'Empty file' });
        continue;
      }

      const role = buildRole(file.relativePath);
      if (!RECRUITMENT_ROLE_PATTERN.test(role)) {
        readErrors.push({ path: file.relativePath, error: `Invalid role pattern: ${role}` });
        continue;
      }

      templates.push({
        scene: deriveDomain(file.relativePath),
        role,
        content: trimmed,
        description: `Imported from ${REPO_URL} — ${file.relativePath}`,
        category: CATEGORY,
        tags: [deriveDomain(file.relativePath), 'agency-agents', 'imported'],
        source: {
          type: 'github',
          repo: REPO_URL,
          path: file.relativePath,
          importedAt: new Date(),
        },
      });
    } catch (err) {
      readErrors.push({ path: file.relativePath, error: err.message });
    }
  }

  console.log(`  Valid templates: ${templates.length}`);
  if (readErrors.length) {
    console.log(`  Read/validation errors: ${readErrors.length}`);
    for (const e of readErrors) {
      console.log(`    ✗ ${e.path}: ${e.error}`);
    }
  }

  if (!templates.length) {
    console.log('No valid templates to import. Exiting.');
    process.exit(1);
  }

  // 3. Connect to MongoDB
  console.log('[3/4] Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('  Connected.');

  // 4. Batch import
  console.log(`[4/4] Importing ${templates.length} templates in batches of ${BATCH_SIZE}...`);

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  const failedDetails = [];
  let batchNum = 0;

  for (let i = 0; i < templates.length; i += BATCH_SIZE) {
    batchNum++;
    const batch = templates.slice(i, i + BATCH_SIZE);
    console.log(`  Batch ${batchNum}: items ${i + 1}-${Math.min(i + BATCH_SIZE, templates.length)}...`);

    for (const tpl of batch) {
      try {
        // Find latest version for this (scene, role)
        const latest = await PromptTemplate
          .findOne({ scene: tpl.scene, role: tpl.role })
          .sort({ version: -1 })
          .select('version')
          .lean()
          .exec();
        const nextVersion = (latest?.version || 0) + 1;
        const isNew = nextVersion === 1;

        const now = new Date();

        // Insert draft
        const created = await PromptTemplate.create({
          scene: tpl.scene,
          role: tpl.role,
          version: nextVersion,
          status: 'draft',
          content: tpl.content,
          description: tpl.description,
          category: tpl.category,
          tags: tpl.tags,
          source: tpl.source,
          updatedBy: OPERATOR_ID,
          updatedAt: now,
        });

        // Audit: create_draft
        await PromptTemplateAudit.create({
          scene: tpl.scene,
          role: tpl.role,
          action: 'create_draft',
          version: nextVersion,
          operatorId: OPERATOR_ID,
          summary: `Import prompt from ${tpl.source.repo}:${tpl.source.path}`,
          createdAt: now,
        });

        if (isNew) {
          totalCreated++;
        } else {
          totalUpdated++;
        }

        // Auto-publish
        if (AUTO_PUBLISH) {
          // Archive any existing published versions
          await PromptTemplate.updateMany(
            { scene: tpl.scene, role: tpl.role, status: 'published', version: { $ne: nextVersion } },
            { $set: { status: 'archived' } },
          );

          // Publish this version
          await PromptTemplate.updateOne(
            { _id: created._id },
            { $set: { status: 'published', updatedAt: new Date() } },
          );

          // Audit: publish
          await PromptTemplateAudit.create({
            scene: tpl.scene,
            role: tpl.role,
            action: 'publish',
            version: nextVersion,
            operatorId: OPERATOR_ID,
            summary: `Auto publish imported draft v${nextVersion}`,
            createdAt: new Date(),
          });
        }
      } catch (err) {
        totalFailed++;
        failedDetails.push({
          scene: tpl.scene,
          role: tpl.role,
          path: tpl.source?.path,
          error: err.message,
        });
      }
    }
  }

  await mongoose.disconnect();

  // ── Report ──────────────────────────────────────────────────────────────
  const totalProcessed = templates.length;
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  导入统计 (Import Statistics)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  totalProcessed : ${totalProcessed}`);
  console.log(`  created        : ${totalCreated}`);
  console.log(`  updated        : ${totalUpdated}`);
  console.log(`  failed         : ${totalFailed}`);
  console.log(`  readSkipped    : ${readErrors.length}`);
  console.log(`  autoPublish    : ${AUTO_PUBLISH}`);
  console.log(`  totalBatches   : ${batchNum}`);
  console.log('───────────────────────────────────────────────────────────────');

  if (failedDetails.length) {
    console.log('  Failed Details:');
    for (const f of failedDetails) {
      console.log(`    ✗ [${f.scene}/${f.role}] ${f.path} — ${f.error}`);
    }
  }

  if (readErrors.length) {
    console.log('  Read/Validation Skip Details:');
    for (const e of readErrors) {
      console.log(`    ⚠ ${e.path} — ${e.error}`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Done.');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
