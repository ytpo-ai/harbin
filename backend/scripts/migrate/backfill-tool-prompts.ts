import mongoose, { Schema } from 'mongoose';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

type ToolRow = {
  id: string;
  canonicalId?: string;
  prompt?: string;
  updatedAt?: Date;
};

const TOOL_PROMPT_PRESETS: Record<string, string> = {
  'builtin.sys-mg.mcp.agent.list':
    '当用户询问“系统里有哪些agents/当前有哪些agent/agent列表”时，请优先调用 builtin.sys-mg.mcp.agent.list 工具获取实时名单，再基于工具结果回答。',
  'builtin.sys-mg.mcp.agent-model.list':
    '当用户询问“系统里有哪些模型/当前有哪些模型/模型列表”时，请优先调用 builtin.sys-mg.mcp.agent-model.list 获取实时模型清单，再回答。',
  'builtin.engineering.internal.docs.read':
    '当用户询问"当前系统实现了哪些核心功能/系统能力清单/docs里实现了什么"时，优先级如下：1) 优先使用 builtin.engineering.internal.repo.read 执行 "git log"、"ls docs/"、"cat docs/..."、"grep ..." 等命令自行读取；2) 其次调用 builtin.engineering.internal.docs.read 读取文档。若 builtin.engineering.internal.docs.read 返回 0 命中或 fallback 信号，必须自动重试（放宽 focus 或不传 focus），仍失败再切换 builtin.engineering.internal.repo.read 直接列目录并读取文档；不要向用户发起二选一确认。必须基于实际读取的内容回答，不得臆测。',
  'builtin.engineering.internal.commit.list':
    '当用户询问"最近24小时/最近一天系统主要更新"时，优先级如下：1) 优先使用 builtin.engineering.internal.repo.read 执行 "git log --since=..." 等命令自行读取提交记录；2) 其次调用 builtin.engineering.internal.commit.list。必须基于实际提交内容回答，不得臆测。',
  'builtin.engineering.internal.repo.read':
    '你拥有 builtin.engineering.internal.repo.read 工具，可执行只读 bash 命令（如 git log、cat、ls、grep 等）来读取本地仓库文件。当你需要了解代码或文档内容时，请优先使用 builtin.engineering.internal.repo.read 直接读取。',
  'builtin.engineering.internal.docs.write':
    '当你需要新增或更新研发文档时，调用 builtin.engineering.internal.docs.write；仅写 docs/** 下的 .md 文件，优先使用 create/update/append 明确意图，避免覆盖不相关内容。',
  'builtin.sys-mg.mcp.agent-memory.list':
    '在处理任务时，优先调用 builtin.sys-mg.mcp.agent-memory.list 检索相关历史备忘录。',
  'builtin.sys-mg.mcp.agent-memory.create':
    '当形成关键结论或后续动作时，调用 builtin.sys-mg.mcp.agent-memory.create 将知识、行为或TODO追加到备忘录。',
};

const toolSchema = new Schema(
  {
    id: { type: String, required: true },
    canonicalId: String,
    prompt: String,
  },
  { timestamps: true, collection: 'tools' },
);

const ToolModel = mongoose.model<ToolRow>('ToolPromptBackfill', toolSchema);

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
  const root = resolve(__dirname, '../..');
  loadEnvFromFile(resolve(root, '.env'));
  loadEnvFromFile(resolve(root, '.env.development'));
  loadEnvFromFile(resolve(root, '.env.local'));
}

function parseArgs(argv: string[]) {
  const onlyArg = argv.find((arg) => arg.startsWith('--only='));
  const overwrite = argv.includes('--overwrite');
  const dryRun = argv.includes('--dry-run');
  const only = onlyArg
    ? onlyArg
        .replace('--only=', '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  return { dryRun, overwrite, only };
}

async function run(): Promise<void> {
  bootstrapEnv();
  const { dryRun, overwrite, only } = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agent-team';
  const targetToolIds = only.length ? only : Object.keys(TOOL_PROMPT_PRESETS);

  await mongoose.connect(mongoUri);
  console.log(`[backfill-tool-prompts] connected mongodb: ${mongoUri}`);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let missing = 0;

  try {
    for (const toolId of targetToolIds) {
      const nextPrompt = TOOL_PROMPT_PRESETS[toolId];
      if (!nextPrompt) {
        console.log(`[backfill-tool-prompts] skip unknown preset: ${toolId}`);
        skipped += 1;
        continue;
      }

      scanned += 1;
      const row = await ToolModel.findOne({ $or: [{ canonicalId: toolId }, { id: toolId }] }).exec();
      if (!row) {
        console.log(`[backfill-tool-prompts] missing tool: ${toolId}`);
        missing += 1;
        continue;
      }

      const currentPrompt = String(row.prompt || '').trim();
      if (!overwrite && currentPrompt) {
        console.log(`[backfill-tool-prompts] keep existing prompt: ${toolId}`);
        skipped += 1;
        continue;
      }

      if (currentPrompt === nextPrompt) {
        console.log(`[backfill-tool-prompts] already up-to-date: ${toolId}`);
        skipped += 1;
        continue;
      }

      if (dryRun) {
        console.log(`[dry-run] update prompt toolId=${toolId} fromLength=${currentPrompt.length} toLength=${nextPrompt.length}`);
        continue;
      }

      await ToolModel.updateOne({ _id: (row as any)._id }, { $set: { prompt: nextPrompt, updatedAt: new Date() } }).exec();
      console.log(`[backfill-tool-prompts] updated: ${toolId}`);
      updated += 1;
    }
  } finally {
    await mongoose.disconnect();
  }

  console.log(
    `[backfill-tool-prompts] done scanned=${scanned} updated=${updated} skipped=${skipped} missing=${missing} dryRun=${dryRun} overwrite=${overwrite}`,
  );
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[backfill-tool-prompts] failed: ${message}`);
  process.exit(1);
});
