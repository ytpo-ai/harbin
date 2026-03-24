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
  - 校验 `category/scene/role/content`
  - `category` 仅允许 `system | recruitment`
  - 当 `category=recruitment` 时，`role` 必须匹配 `<domain>:<persona-role>`（`/^[a-z0-9-]+:[a-z0-9-]+$/`）
  - 调用 `PromptRegistryAdminService.saveDraft()` 递增版本保存
  - 可选 `autoPublish=true` 自动发布当前版本
- 输出统计：`totalProcessed/created/updated/failed/details`

## 4.1 Prompt Read 工具（list/get）

- `builtin.sys-mg.mcp.prompt-registry.list-templates`
  - 查询 Prompt 模板摘要，支持 `scene/role/category/status/limit` 过滤
  - 返回字段不含 `content`，用于低 token 成本浏览
- `builtin.sys-mg.mcp.prompt-registry.get-template`
  - 通过 `scene+role` 获取当前生效模板，或通过 `templateId` 直接读取
  - 返回完整 `content` 与版本信息

## 5. PromptTemplate Schema 扩展

- 新增字段：
  - `category?: string`
  - `tags?: string[]`
  - `source?: { type, repo, path, importedAt }`
- 兼容性：保留原有唯一索引 `scene + role + version`。

## 6. Agent/Skill Prompt 绑定（新增）

- `agent.schema.ts` 与 `agent-skill.schema.ts` 新增 `promptTemplateRef?: { scene, role }`。
- Agent 运行时注入：
  - Identity Layer 在 `systemPrompt` 后追加 `agent.promptTemplateRef` 解析内容。
  - Toolset Layer 在 skill 激活时优先解析 `skill.promptTemplateRef`；成功时替换 `skill.content`，失败时回退 `skill.content`。
- 创建/更新 Agent 与 Skill API 支持设置和清除 `promptTemplateRef`（清除时写入 `$unset`）。

## 7. 工具分配与执行者映射（2026-03-24 补充）

### 工具注册状态

| 工具 | Tool ID | agent_tools.enabled |
|---|---|---|
| Repo Writer | `builtin.sys-mg.internal.rd-related.repo-writer` | true |
| Prompt Registry Save Template | `builtin.sys-mg.mcp.prompt-registry.save-template` | true |

### 已分配 Agent（数据库实际状态）

| Agent | ID | roleId | repo-writer | save-prompt-template |
|---|---|---|---|---|
| Docter-W | `69bc21e4df02210ddbc5707a` | role-technical-architect | 是 | 是 |
| Coder-T | `69bd2c1af71ae480313d7f35` | role-fullstack-engineer | 是 | 是 |

### 已分配角色 Profile

| roleCode | 含 repo-writer | 含 save-prompt-template |
|---|---|---|
| technical-architect | 是 | 是 |
| fullstack-engineer | 是 | 是 |

### 编排注意事项

1. 编排计划中涉及 `repo-writer` 或 `save-prompt-template` 的任务，必须分配给 Docter-W 或 Coder-T
2. 当前 Planner 的 Agent Manifest 存在 2000 字符截断问题，这两个 Agent 可能被截断不可见（见 `docs/issue/fix/2026-03-24-planner-agent-manifest-truncation-deadloop.md`）
3. 验证工具分配时必须查数据库，不能只看种子文件代码
