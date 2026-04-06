# AGENT_TOOL_ID_FINAL_STANDARDIZATION_AND_CLEANUP_PLAN

## 背景

上线前需要对 Agents 工具体系进行最后一轮严格标准化，目标是：

1. 工具 ID 命名统一为 `TOOL_ID__*`。
2. 工具分发代码不再出现 tool id 字面量，全部走常量。
3. 清理历史兼容残留（`DEPRECATED_TOOL_IDS`、legacy agent list 工具）。
4. 保留并显式化旧数据清理能力，确保生产存量可一次性治理。

## 范围

- 后端：`backend/apps/agents/src/modules/tools/**`
- 种子脚本：`backend/scripts/seed/builtin-tool-seed.ts`
- 计划文档：`docs/plan/**`

## 执行计划

### 1) 常量命名与定义文件规范化

- 将工具常量统一为 `TOOL_ID__*` 前缀。
- `builtin-tool-definitions.ts` 中所有工具 ID 定义按 `id` 字符串值升序排列。
- 删除 `TOOL_ID__LEGACY_AGENT_LIST` 常量定义。

### 2) Tool Catalog 统一引用

- `builtin-tool-catalog.ts` 中所有 `id` 字段统一引用 `TOOL_ID__*` 常量。
- 移除 legacy 工具在 `IMPLEMENTED_TOOL_IDS` 的挂载。

### 3) Dispatcher 100% 常量化

- `tool-execution-dispatcher.service.ts` 所有 switch 分发中的 tool id 字面量替换为 `TOOL_ID__*`。
- 覆盖主分发与子分发：repo/prompt/orchestration/requirement。

### 4) 过期集合清理与替代

- 删除 `DEPRECATED_TOOL_IDS` 常量与所有引用。
- 在 seed 脚本内维护显式清理列表 `TOOL_IDS_TO_PURGE_ON_SYNC`，用于 sync 模式清理旧数据。
- 清理列表包含 legacy agent-admin id 及历史过期工具 id。

### 5) 上线前数据清理与验证

- 预发/生产执行一次 sync seed，触发旧工具 id 清理。
- 验证代码侧无残留：
  - 无 `DEPRECATED_TOOL_IDS`
  - 无 `TOOL_ID__LEGACY_AGENT_LIST`
  - dispatcher 无 `builtin.*`/`composio.*` 工具 id 字面量
- 验证关键工具链路可用（工具注册、执行分发、schema 查询、meeting/orchestration/requirement 核心路径）。

## 影响点

- 后端/API：工具分发路由、工具注册 seed 同步逻辑。
- 数据库：`agent_tools` 历史工具 id 清理与元数据对齐。
- 文档：规范收敛到 `TOOL_ID__*` 常量体系。

## 风险与控制

- 风险：外部仍调用历史 tool id，可能命中未实现。
- 控制：上线窗口执行 sync 清理并观察日志，必要时追加一次针对性清理。

## 验收标准

1. 代码中无 `DEPRECATED_TOOL_IDS` 与 `TOOL_ID__LEGACY_AGENT_LIST`。
2. `tool-execution-dispatcher.service.ts` tool id 全部常量化。
3. `builtin-tool-definitions.ts` 工具常量按 id 值有序。
4. sync 后无关键工具缺失，核心工具调用链冒烟通过。

## 实施结果（2026-04-06）

### 已完成

- `builtin-tool-definitions.ts` 完成全量工具 ID 常量化与命名收敛，统一 `TOOL_ID__*` 前缀，并保持按 `id` 值排序。
- 删除历史残留：`DEPRECATED_TOOL_IDS`、`TOOL_ID__LEGACY_AGENT_LIST`、`TOOL_ID__MEETING_GENERATE_SUMMARY`。
- `tool-execution-dispatcher.service.ts` 已 100% 改为常量分发，不再使用工具 ID 字符串字面量。
- `builtin-tool-catalog.ts` 中所有 prompt/toolId 示例已改为通过 `${TOOL_ID__*}` 引用，不再硬编码工具 ID 文案。
- 编排工具标准化：
  - `TOOL_ID__ORCHESTRATION_INIT_PLAN`
  - `TOOL_ID__ORCHESTRATION_SUBMIT_TASK_RUN_RESULT`
- 会议与审计工具常量名收敛：
  - `TOOL_ID__MEETING_LIST`
  - `TOOL_ID__EMPLYEE_LOGS`
- 信息检索工具域收敛：
  - `TOOL_ID__WEB_FETCH` -> `builtin.data-gathering.internal.web.fetch`
  - `TOOL_ID__WEB_SEARCH_EXA` -> `builtin.data-gathering.internal.web.search-exa`
- 研发域工具收敛：
  - `TOOL_ID__ENGINEERING_DOCS_WRITE`
  - `TOOL_ID__ENGINEERING_REPO_WRITER`
  - `builtin.engineering.<internal|mcp>.<resource>.<action>` 命名分层落地。
- Memory/Model/Skill 增加 agent 标识并统一为 mcp/internal 语义路径：
  - `agent-memory.*`
  - `agent-model.*`
  - `agent-skill.*`

### 数据清理策略

- `backend/scripts/seed/builtin-tool-seed.ts` 保留并扩展 `TOOL_IDS_TO_PURGE_ON_SYNC`，用于清理历史旧 ID 与中间过渡 ID。
- 本轮不做映射兼容层，按“新 ID 直切 + 存量数据后续清空/清理”的策略执行。
- 在确认线上/历史库虚拟占位工具已清空后，移除 `VIRTUAL_TOOL_IDS` 常量及其 sync 删除逻辑，统一由 `TOOL_IDS_TO_PURGE_ON_SYNC` 负责清理入口。
