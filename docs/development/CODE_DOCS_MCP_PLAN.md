# CODE_DOCS_MCP 开发总结

## 背景与目标

本次迭代目标是将"可读取仓库 docs"升级为可在 CTO 问答中稳定使用的 MCP 能力，确保对于"当前系统实现了哪些核心功能"类问题，回答可追溯、可验证，且避免泛化臆测。

经过优化，新增了三种工具实现方式，agent 可根据场景灵活选择。

## 关键实现

### 1. 工具矩阵

| 工具 ID | 名称 | 方式 | 说明 |
|---------|------|------|------|
| `repo-read` | Repo Read | bash 直接读取 | 允许 git log/cat/ls/grep 等只读命令 |
| `local-repo-docs-reader` | Local Repo Docs Reader | 后端读取原始内容 | 读取 docs/ 目录下所有 markdown |
| `local-repo-updates-reader` | Local Repo Updates Reader | 后端读取原始内容 | 读取 git 提交记录 |
| `gh-repo-docs-reader-mcp` | GH Repo Docs Reader MCP | 结构化摘要 | 从文档提取功能特性（原有） |
| `gh-repo-updates-mcp` | GH Repo Updates MCP | 结构化摘要 | 从提交分析变更主题（原有） |

### 2. 工具优先级

当用户询问"系统核心功能"或"最近更新"时，agent 优先使用：

1. **repo-read** - 直接执行 bash 命令读取（最灵活）
2. **local-repo-docs-reader / local-repo-updates-reader** - 读取原始内容返回
3. **gh-repo-docs-reader-mcp / gh-repo-updates-mcp** - 结构化摘要（原有）

### 3. repo-read 工具

- 允许命令：`git log/show/diff`, `cat`, `ls`, `grep`, `head`, `tail`, `find`
- 只读操作，受限于项目根目录
- 输出命令执行结果

### 4. 文件重命名

原有工具已重命名以区分实现方式：
- `code-docs-mcp` → `gh-repo-docs-reader-mcp`
- `code-updates-mcp` → `gh-repo-updates-mcp`
- `code-docs-reader` → `local-repo-docs-reader`
- `code-updates-reader` → `local-repo-updates-reader`

## 影响文件

- `backend/apps/agents/src/modules/tools/tool.service.ts`
- `backend/apps/agents/src/modules/tools/gh-repo-docs-reader-mcp.util.ts`
- `backend/apps/agents/src/modules/tools/gh-repo-updates-mcp.util.ts`
- `backend/apps/agents/src/modules/tools/local-repo-docs-reader.util.ts`
- `backend/apps/agents/src/modules/tools/local-repo-updates-reader.util.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`

## 验证结果

- `npm run build`（`backend/`）通过。

## 本次会话补充（2026-03-08）

### 1) local-repo-docs-reader 错误诊断增强

- 增加错误类型与排障信息：`WORKSPACE_ROOT_NOT_FOUND`、`DOCS_DIRECTORY_NOT_FOUND`、`NO_DOCS_FOUND`。
- 在 `tool.service.ts` 透传 `errorType/troubleshooting`，让上层 Agent 能识别失败原因并给出可执行建议。

### 2) focus 匹配与自动兜底

- `focus` 从“整句包含”升级为“关键词分词 OR 命中”（路径优先、内容次之）。
- 当路径和内容均未命中时，不再直接中断，而是自动回退读取高优先级文档（README/features/architecture/api）。
- 新增观测字段：`matchMode`、`focusMatchedCount`、`fallbackApplied`、`retryCount`、`attemptedKeywords`、`suggestions`。

### 3) Agent 提示词约束修正

- 在 `agent.service.ts` 增加约束：遇到 docs 0 命中必须自动重试（放宽 focus 或不传 focus），仍失败再切换 `repo-read`。
- 约束“不向用户发起二选一追问”，避免多轮阻塞式交互。

### 4) Runtime content 校验修复

- 修复 `AgentMessage validation failed: content is required`：
  - `runtime-persistence.service.ts` 中统一 `messageContent = input.content ?? ''`，并同时用于 `message.save` 与 `appendMessageToSession`。
  - 避免出现 model 层已归一化但 session 侧仍传入 `undefined` 的不一致。

### 5) 结果

- 读取 docs 能力从“命中失败即卡住”升级为“可诊断 + 自动兜底 + 单次可交付”。
- Runtime 写入链路的 `content` 必填问题得到修复，构建验证通过。

## 结论

现已支持三种工具实现方式，agent 可根据具体场景选择最适合的方式：
- 需快速获取 → 使用 MCP 摘要
- 需完整内容 → 使用 reader 工具
- 需灵活查询 → 使用 repo-read 直接操作

---

## 历史版本（合并归档）

> 以下为原版，已实现说明保留作为历史参考。

### 原版：gh-repo-docs-reader-mcp

1. 新增内置工具 `gh-repo-docs-reader-mcp`
   - 入参支持 `query/focus/maxFeatures/maxEvidencePerFeature`
   - 输出包含 `coreFeatures`、`analyzedFiles`、`unknownBoundary`

2. 新增 docs 功能抽取与聚合逻辑
   - 从文档提取候选功能并聚合为核心能力分组

3. CTO 侧能力控制与提示约束
   - 提示词约束要求基于证据路径回答

### 原版：gh-repo-updates-mcp

1. 摘要质量提升
   - 从"单提交直出"升级为"按主题聚合多提交"
   - 输出增加 `whatChanged/whyItMatters/evidenceFiles/severity`

2. 支持 `minSeverity` 过滤低价值变更

# code-docs-mcp 能力建设计划

## 需求目标

在现有“可读取仓库 docs 文档”基础上，补齐 `code-docs-mcp` 能力，使 CTO 在被问询“当前系统实现了哪些核心功能”时，能够给出稳定、结构化、可追溯（带文档依据路径）的回答。

## 执行步骤

1. 盘点 CTO 问答链路与现有 docs 读取实现，明确 `code-docs-mcp` 的接入点与输入输出约定。
2. 在 agents 服务新增 `code-docs-mcp` 内置工具，实现对仓库 docs 的检索、关键信息提取与结果聚合。
3. 设计“核心功能盘点”输出协议：包含功能清单、功能说明、证据文档路径与置信边界（已知/未知）。
4. 将 CTO 默认工具集与 system prompt 约束接入 `code-docs-mcp`，确保该类问题优先走工具而非记忆回答。
5. 增加测试覆盖：核心功能问答命中、多文档聚合、无结果兜底边界。
6. 更新 README 与 API/功能文档，说明 `code-docs-mcp` 使用方式、回答结构和能力边界。

## 关键影响点

- 后端（agents）：工具注册与执行逻辑、CTO 默认工具集、system prompt 行为约束。
- 后端（engineering-intelligence）：复用或扩展 docs 读取能力作为数据来源。
- API：新增或扩展工具调用能力的返回结构。
- 测试：新增工具行为与问答链路相关测试。
- 文档：README、`docs/features/FUNCTIONS.md`、`docs/api/API.md` 需要同步。

## 风险与依赖

- 依赖目标仓库 docs 内容质量与结构一致性；若文档稀疏，功能抽取准确率会下降。
- 若问题表述过于宽泛，需通过输出协议显式标注未知项，避免生成式臆测。
- 若后续需要跨仓库聚合，需补充分仓库权重和冲突处理策略。

## 补充修复（CTO 会议超时）

### 修复目标

1. 修复 CTO 在会议讨论中调用 OpenAI 模型时 `Request timed out` 导致任务失败的问题。
2. 在不改变业务语义的前提下提升调用稳定性与可恢复性。

### 修复步骤

1. 将 OpenAI SDK 超时从硬编码改为环境变量可配置（默认提升到 60s），并支持基础重试。
2. 在 Agent 执行链路增加超时识别与兜底回复，避免整次任务因超时异常中断。
3. 更新 `README.md` 与 `.env.example`，补充 `OPENAI_TIMEOUT_MS`、`OPENAI_MAX_RETRIES` 配置说明。
4. 执行 `agents` 服务构建验证，确认修复不引入编译问题。

## 补充修复（code-docs-mcp 强制触发）

### 修复目标

1. 解决 CTO 在回答“系统核心功能”问题时偶发未调用 `code-docs-mcp`、直接泛化回答的问题。
2. 将“优先调用”升级为后端硬触发，确保回答具备 docs 证据路径。

### 修复步骤

1. 在 `AgentService` 增加核心功能问询意图识别（中文/英文关键词）。
2. 命中意图且具备 `code-docs-mcp` 权限时，后端先强制执行工具，再组织结构化回答。
3. 对工具失败或无结果场景输出“已知/未知边界”兜底文案，避免自由臆测。
4. 增加日志标记（forced tool call）并完成 `agents` 服务构建验证。

## 能力扩展（最近24小时主要更新）

### 扩展目标

1. 支持 CTO 回答“总结系统最近24小时主要更新”类问题。
2. 回答基于 git 真实变更（时间窗口）与证据，避免模型臆测。

### 扩展步骤

1. 新增 `code-updates-mcp` 工具：按时间窗口读取 git 提交与文件变更。
2. 产出结构化结果：更新摘要、影响模块、证据（commit/hash/time/files）。
3. 在 CTO 链路加入“最近X小时更新”意图硬触发，优先工具回答。
4. 补充无结果兜底边界并更新 README/API/功能文档。
5. 完成 `agents` 服务构建验证与回归说明。
