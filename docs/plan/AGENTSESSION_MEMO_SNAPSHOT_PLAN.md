# AgentSession Memo Snapshot 方案

## 背景

当前 AgentSession 中主要保存消息与上下文引用信息，Memo 仍需额外查询，导致会话侧无法直接展示可读 Memo 内容（尤其是 identity）。

## 目标

在 AgentSession 中新增可展示的 `memoSnapshot` 字段，返回会话时直接包含 memo 内容快照，而不是仅有引用。

## 执行步骤

✅ 1. ~~梳理 AgentSession 数据模型与读写链路~~ → 已在 agents 服务统一处理
✅ 2. 扩展 AgentSession schema：新增 `memoSnapshot` 结构（identity/todo/topic 的精简展示内容与更新时间）
✅ 3. 在 agents 服务会话构建阶段（RuntimeOrchestratorService.startRun）自动写入 memoSnapshot
✅ 4. 移除 orchestration 侧的 memoSnapshot 逻辑（统一在 agents 侧处理）
✅ 5. 完成类型校验

## 关键改动点

- **agents 服务**：
  - `backend/apps/agents/src/schemas/agent-session.schema.ts` - 添加 memoSnapshot 字段
  - `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts` - startRun 时刷新 memoSnapshot
  - `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts` - 持久化 memoSnapshot
  - `backend/apps/agents/src/modules/runtime/runtime.module.ts` - 导入 MemoModule

- **主应用**：
  - 移除 `backend/src/modules/orchestration/session-manager.service.ts` 中的 memoSnapshot 逻辑

- **前端**：
  - `frontend/src/services/orchestrationService.ts` - AgentSession 类型已包含 memoSnapshot

- **文档**：
  - `docs/api/legacy-api.md` - 补充 memoSnapshot 字段说明

## 效果

现在所有调用 agents 服务 startRun 的场景（orchestration、meeting），都会自动在 AgentSession 中写入 memoSnapshot，并持久化到 MongoDB。查询 session 时直接返回 memo 内容，无需额外查询。
