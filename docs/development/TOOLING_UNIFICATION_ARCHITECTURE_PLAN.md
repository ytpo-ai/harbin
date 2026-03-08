# 工具系统统一化架构开发总结

## 1. 背景与目标

本轮开发围绕 `docs/plan/TOOLING_UNIFICATION_ARCHITECTURE_PLAN.md` 执行，目标是将系统工具管理从“toolkit 型 + 单工具型并行”收敛为统一模型。

用户进一步确认当前系统未投入生产，因此采用“**直接移除旧能力**”策略，不保留长期迁移兼容分支。

## 2. 本轮已完成实现

### 2.1 后端工具模型统一（canonical-only）

- 工具主键语义切到 canonical toolId（`provider.namespace.resource/action` 风格）。
- 删除 legacy 映射实现文件：
  - `backend/apps/agents/src/modules/tools/tool-id-mapping.ts`
- 删除 alias 映射相关运行时开关与统计逻辑，工具查询/执行不再走 legacy 分支。

### 2.2 Tool + Toolkit 双实体落地

- 已有 `Tool` 扩展字段持续沿用（provider/namespace/toolkitId/resource/action 等）。
- 新增 `Toolkit` 独立实体：
  - `backend/src/shared/schemas/toolkit.schema.ts`
- `ToolModule` 注入 `Toolkit` model：
  - `backend/apps/agents/src/modules/tools/tool.module.ts`
- `ToolService` 增加 Toolkit 同步能力：
  - 基于工具集合自动 upsert Toolkit
  - 无效 Toolkit 标记 `deprecated`

### 2.3 统一 Registry 与 Toolkit API

- 工具查询：`GET /tools/registry`
- Toolkit 查询：
  - `GET /tools/toolkits`
  - `GET /tools/toolkits/:id`
- 删除迁移期接口：
  - `/tools/registry/mappings`
  - `/tools/registry/alias-hits`
  - `/tools/registry/alias-cutoff-readiness`
  - `/tools/registry/alias-mapping-status`

### 2.4 内置工具与运行时调用全面 canonical 化

- `ToolService` 内置工具定义 ID 全部改为 canonical（例如 `internal.memo.search`、`mcp.model.list`、`mcp.orchestration.createPlan`）。
- `executeToolImplementation` 分发分支与 `getImplementedToolIds` 完成同步改造。
- Agent 侧默认工具与 profile seed 工具改为 canonical。

### 2.5 前端工具管理改造

- `Tools` 页：
  - 数据源切到 `/tools/registry`
  - 增加 `provider/namespace/toolkitId` 筛选
  - 执行历史展示 canonical `toolId`（并支持显示 legacy 字段兼容）
- `Agents` 页：
  - 创建 Agent、编辑 Agent、编辑 MCP Profile 的工具选择统一用 canonical key
  - MCP Profile 与 Agent 工具选择增加 `provider/namespace` 筛选
  - 工具列表支持按 namespace 分组展示

## 3. 关键修复记录

- 修复 Toolkit 推导错误：`internal.memo.search` 的 Toolkit 从错误的 `internal.internal` 修正为 `internal.memo`。
- 推导规则改为基于 canonical toolId 解析 provider/namespace，而非依赖历史冗余字段。

## 4. 文档同步更新

- 功能文档：`docs/features/AGENT_TOOL.md`
- 计划文档：`docs/plan/TOOLING_UNIFICATION_ARCHITECTURE_PLAN.md`
- 迁移清单：`docs/plan/TOOLING_UNIFICATION_TOOL_MIGRATION_CHECKLIST.md`
- 技术文档：`docs/technical/TOOLING_UNIFICATION_ARCHITECTURE_DESIGN.md`
- API 文档：`docs/api/agents-api.md`

## 5. 构建验证

- 后端：`pnpm run build:agents`（通过）
- 前端：`pnpm run build`（通过）

## 6. 当前仍需继续推进项（非迁移/公告）

在“直接删旧功能”的前提下，仍建议继续完成：

1. 两级路由（Domain Routing + Action Top-K）落地。
2. 治理策略统一（timeout/retry/idempotency/rate limit/circuit breaker）。
3. 指标与告警看板落地（成功率、延迟、失败码、token 成本）。
4. 功能/权限/安全/性能回归验收与清单收口。
