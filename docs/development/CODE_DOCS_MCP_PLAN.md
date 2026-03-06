# CODE_DOCS_MCP 开发总结

## 背景与目标

本次迭代目标是将“可读取仓库 docs”升级为可在 CTO 问答中稳定使用的 `code-docs-mcp` 能力，确保对于“当前系统实现了哪些核心功能”类问题，回答可追溯、可验证，且避免泛化臆测。

## 关键实现

1. 新增内置工具 `code-docs-mcp`
   - 在 tools 模块注册并可执行。
   - 入参支持 `query/focus/maxFeatures/maxEvidencePerFeature`。
   - 输出包含 `coreFeatures`、`analyzedFiles`、`unknownBoundary`。

2. 新增 docs 功能抽取与聚合逻辑
   - 从 `README.md`、`docs/features/FUNCTIONS.md` 等文档提取候选功能。
   - 聚合为核心能力分组，并携带证据路径与行号。

3. CTO 侧能力控制与提示约束
   - 仅 CTO 默认具备 `code-docs-mcp`。
   - 非 CTO 默认移除该工具。
   - 提示词约束要求基于证据路径回答，并声明未知边界。

4. 后端硬触发（关键修复）
   - 对“核心功能盘点”意图增加后端识别。
   - 命中后先强制调用 `code-docs-mcp`，再格式化输出。
   - 避免模型跳过工具直接口播泛化内容。

5. OpenAI 超时稳定性修复
   - 将超时与重试改为环境变量可配置：
     - `OPENAI_TIMEOUT_MS`（默认 60000）
     - `OPENAI_MAX_RETRIES`（默认 1）
   - Agent 执行链路识别超时并输出兜底文案，避免直接异常中断。

6. `code-updates-mcp` 摘要质量提升
   - 从“单提交直出”升级为“按主题聚合多提交”。
   - 输出增加 `whatChanged/whyItMatters/evidenceFiles/severity`，减少泛化描述。
   - 支持 `minSeverity` 过滤低价值变更，提升“主要更新”可读性。

## 影响文件

- `backend/apps/agents/src/modules/tools/tool.service.ts`
- `backend/apps/agents/src/modules/tools/code-docs-mcp.util.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`
- `backend/libs/models/src/openai-provider.ts`
- `docs/plan/CODE_DOCS_MCP_PLAN.md`
- `docs/features/FUNCTIONS.md`
- `docs/api/API.md`
- `README.md`
- `backend/.env.example`

## 验证结果

- `npm run build:agents` 通过。
- 关键运行日志可见：`Forced tool call triggered: code-docs-mcp`。

## 结论

`code-docs-mcp` 已具备“可调用 + 可控 + 可追溯 + 可兜底”的闭环能力，能够支撑 CTO 在核心功能问答场景中稳定返回基于 docs 证据的答案。

---

## 计划原文（合并归档：CODE_DOCS_MCP_PLAN.md）

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
