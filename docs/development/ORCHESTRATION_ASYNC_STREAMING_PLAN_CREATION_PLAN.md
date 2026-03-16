# 计划编排异步流式创建开发总结

## 背景与目标

- 现状：`POST /orchestration/plans/from-prompt` 会同步等待 Planner 完成任务拆解，容易被长耗时推理拖住并触发 504。
- 目标：创建接口“秒回”，后台异步生成任务，并让前端在详情页逐条看到任务生成过程（step-like 体验）。

## 本次实现范围

### 后端

- `backend/src/modules/orchestration/orchestration.service.ts`
  - 创建计划改为占位落库（`status=drafting`）后立即返回。
  - 新增后台异步编排流程：逐条创建任务、逐条更新 `planSession` 与 `stats`。
  - 新增计划事件流内存通道，支持推送计划状态与任务生成事件。
- `backend/src/modules/orchestration/orchestration.controller.ts`
  - 新增 `GET /orchestration/plans/:id/events`（SSE）接口。
  - SSE 鉴权支持 `authorization` 头和 `access_token` 查询参数兜底。
- `backend/src/shared/schemas/orchestration-plan.schema.ts`
  - 计划状态新增 `drafting`。
- `backend/src/shared/types.ts`
  - 增加 `export type Task = AgentExecutionTask` 兼容导出，修复 agents app 对旧 `Task` 类型引用的编译错误。

### 前端

- `frontend/src/pages/Orchestration.tsx`
  - 创建成功后自动跳转 `/orchestration/plans/:id`。
  - 增加 `drafting` 状态展示样式。
- `frontend/src/pages/PlanDetail.tsx`
  - 详情页接入计划 SSE 订阅。
  - `drafting` 态展示“任务生成中”提示。
  - 收到 `plan.task.generated` 事件后实时刷新并高亮新任务。
  - SSE 异常时展示重连提示，同时保留轮询兜底。
- `frontend/src/services/orchestrationService.ts`
  - 新增 `subscribePlanEvents` 封装和 `PlanStreamEvent` 类型。

## 事件模型

- `plan.status.changed`：计划状态变化（含 `drafting` 阶段）。
- `plan.task.generated`：单条任务生成完成并可展示。
- `plan.completed`：任务全部生成完成，计划进入 `planned`。
- `plan.failed`：异步生成失败，计划进入 `failed`，并记录错误信息。

## 用户体验变化

- 创建计划后无需等待完整任务拆解，页面立即跳转详情。
- 任务按生成顺序逐条出现，不再“全部完成后一次性显示”。
- 失败时可快速感知，避免用户误以为页面卡死。

## 验证结果

- 后端：`npm run build`、`npm run lint` 通过。
- Agents：`npm run build:agents` 通过（含 `Task` 类型兼容修复验证）。
- 前端：`npm run build` 通过。

## 风险与后续建议

- 当前 SSE 事件分发为单实例内存通道；若后续多实例部署，需要升级为跨实例事件总线（如 Redis Pub/Sub）。
- 前端目前采用“事件驱动 + 轮询兜底”双机制，后续可增加 `Last-Event-ID` 续传以优化断线恢复。

## 关联文档

- 规划文档：`docs/plan/ORCHESTRATION_ASYNC_STREAMING_PLAN_CREATION_PLAN.md`
- 功能文档：`docs/feature/ORCHETRATION_TASK.md`
- API 文档：`docs/api/agents-api.md`
