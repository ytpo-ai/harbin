# PROMPT IMPORT REPO WRITER TOOL GUIDE

## 1. 范围与定位

- 目标链路：`repo-writer -> repo-read -> save-prompt-template`。
- 能力归属：
  - repo 类工具在 `backend/apps/agents/src/modules/tools/repo-tool-handler.service.ts`
  - PromptTemplate 写入在 `backend/apps/agents/src/modules/tools/prompt-registry-tool-handler.service.ts`
  - 调度入口在 `backend/apps/agents/src/modules/tools/tool.service.ts`

## 2. 工具分发链路

1. Tool 执行入口：`ToolService.executeToolImplementation()`。
2. repo 工具通过 `dispatchRepoToolImplementation()` 分发。
3. prompt-registry 工具通过 `dispatchPromptRegistryToolImplementation()` 分发。
4. 内置工具目录由 `builtin-tool-catalog.ts` 定义，常量 ID 在 `builtin-tool-definitions.ts`。

## 3. repo-writer 关键约束

- Tool ID：`builtin.sys-mg.internal.rd-related.repo-writer`
- 当前动作：仅允许 `action=git-clone`
- 安全边界：
  - 仅允许 `https://` 仓库地址
  - 目标路径强制落在 `${workspaceRoot}/data/repos/**`
  - 拒绝 `targetDir` 路径穿越
- 行为：
  - 目录已存在且为 git 仓库：`fetch + checkout + pull --ff-only`
  - 不存在：`git clone --depth 1 --branch <branch>`

## 4. save-prompt-template 关键约束

- Tool ID：`builtin.sys-mg.mcp.prompt-registry.save-template`
- 支持单条或批量 `templates[]` 导入
- 逐条执行：
  - 校验 `scene/role/content`
  - 调用 `PromptRegistryAdminService.saveDraft()` 递增版本保存
  - 可选 `autoPublish=true` 自动发布当前版本
- 输出统计：`totalProcessed/created/updated/failed/details`

## 5. PromptTemplate Schema 扩展

- 新增字段：
  - `category?: string`
  - `tags?: string[]`
  - `source?: { type, repo, path, importedAt }`
- 兼容性：保留原有唯一索引 `scene + role + version`。
