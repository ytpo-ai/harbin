/**
 * Seed planningRules for the cto-rd-workflow skill.
 *
 * Usage:
 *   npx ts-node scripts/seed-skill-planning-rules.ts
 *   npx ts-node scripts/seed-skill-planning-rules.ts --dry-run
 *
 * This script finds the cto-rd-workflow skill by slug and sets its
 * `planningRules` field with structured constraints that the
 * PlanningContextService and PlannerService can machine-validate.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import mongoose, { Schema } from 'mongoose';

// ---------------------------------------------------------------------------
// Planning Rules definition for cto-rd-workflow
// ---------------------------------------------------------------------------

const CTO_RD_WORKFLOW_PLANNING_RULES = [
  // 1. Forbidden: Step0/Step1 should not appear as independent tasks
  {
    type: 'forbidden_task_pattern',
    rule: '禁止将 Step0（信息采集）或 Step1（理解需求/分类打标）映射为独立编排 task，它们是 CTO 在 planning 阶段的内部动作',
    validate: '(Step\\s*0|Step\\s*1|信息采集|理解需求|需求理解|分类打标|理解\\+分类|理解与分类)',
  },
  // 2. Forbidden: Template-copy task descriptions
  {
    type: 'forbidden_task_pattern',
    rule: '禁止 task description 中出现纯 skill 模板复述（如"明确需求目标、影响范围、已知信息、不确定项"）',
    validate: '(明确需求目标.*影响范围.*已知信息|明确需求目标.*不确定项)',
  },
  // 3. Forbidden: Tasks with Step-referencing descriptions only
  {
    type: 'forbidden_task_pattern',
    rule: '禁止以"基于 StepN 方案"作为 task description 的主体内容（无具体文件/接口信息）',
    validate: '^基于\\s*(Step|步骤)\\s*\\d+\\s*(方案|输出|结论).{0,30}$',
  },
  // 4. Task count constraint
  {
    type: 'task_count',
    rule: '任务数量应控制在 3-7 个（简单需求 3-4，中等 4-5，复杂 5-7）',
    validate: '{"min":3,"max":7}',
  },
  // 5. Description quality: must contain file paths or interface/field names
  {
    type: 'description_quality',
    rule: 'task description 必须包含具体的文件路径、接口名或字段名（如 frontend/src/pages/xxx.tsx、listXxx 接口、xxxField 字段）',
    validate: '([a-zA-Z\\/\\\\]+\\.(ts|tsx|js|jsx|md|json)|[a-zA-Z]+\\.[a-zA-Z]+\\.(ts|tsx)|[a-z]+[A-Z][a-zA-Z]*\\s*(接口|字段|方法|函数)|\\b(controller|service|schema|model|component|page)\\b)',
  },
  // 6. Dependency rule: test/verify tasks must depend on implementation tasks
  {
    type: 'dependency_rule',
    rule: '验收/测试类 task 必须依赖所有开发实现类 task，不得与开发 task 平行',
    validate: '',
  },
];

// ---------------------------------------------------------------------------
// Mongoose bootstrap
// ---------------------------------------------------------------------------

const skillSchema = new Schema(
  {
    id: { type: String, required: true },
    slug: { type: String, required: true },
    name: String,
    planningRules: { type: [Object], default: [] },
  },
  { timestamps: true, collection: 'agent_skills', strict: false },
);

const SkillModel = mongoose.model('SkillPlanningRulesSeed', skillSchema);

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  bootstrapEnv();
  const dryRun = process.argv.includes('--dry-run');
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agent-team';

  console.log(`[seed-skill-planning-rules] Connecting to ${mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);
  await mongoose.connect(mongoUri);

  const skill = await SkillModel.findOne({ slug: 'cto-rd-workflow' }).exec();
  if (!skill) {
    console.error('[seed-skill-planning-rules] ERROR: skill with slug "cto-rd-workflow" not found');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`[seed-skill-planning-rules] Found skill: id=${skill.id}, name=${skill.name}`);
  console.log(`[seed-skill-planning-rules] Current planningRules: ${JSON.stringify(skill.planningRules || [])}`);
  console.log(`[seed-skill-planning-rules] New planningRules (${CTO_RD_WORKFLOW_PLANNING_RULES.length} rules):`);

  for (const rule of CTO_RD_WORKFLOW_PLANNING_RULES) {
    console.log(`  - [${rule.type}] ${rule.rule}`);
    if (rule.validate) {
      console.log(`    validate: ${rule.validate}`);
    }
  }

  if (dryRun) {
    console.log('[seed-skill-planning-rules] DRY RUN — no changes made');
  } else {
    await SkillModel.updateOne(
      { slug: 'cto-rd-workflow' },
      {
        $set: {
          planningRules: CTO_RD_WORKFLOW_PLANNING_RULES,
          updatedAt: new Date(),
        },
      },
    ).exec();
    console.log('[seed-skill-planning-rules] planningRules updated successfully');
  }

  await mongoose.disconnect();
  console.log('[seed-skill-planning-rules] Done');
}

run().catch((err) => {
  console.error('[seed-skill-planning-rules] Fatal error:', err);
  process.exit(1);
});
