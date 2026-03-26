# ORCHESTRATION EVENT DRIVEN DISPATCHER RUNTIME

## 已落地改造（2026-03-27）

- 引入进程内事件总线：`@nestjs/event-emitter` + `EventEmitterModule.forRoot({ wildcard: true })`。
- 新增统一事件定义：`backend/src/modules/orchestration/orchestration-events.ts`。
- 新增四阶段调度器：`backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`。
- 新增事件监听器：`backend/src/modules/orchestration/services/orchestration-event-listener.service.ts`，通过 `@OnEvent(ORCH_EVENTS.ADVANCE_REQUESTED)` 接入外部触发。
- Controller 新增外部推进端点：`POST /orchestration/plans/:id/advance`。
- 旧 `IncrementalPlanningService.executeIncrementalPlanning()` 的 `for(;;)` 无限循环已移除，改为 `setImmediate` 递进推进。
- Replan 流程补齐 planner session 生命周期：先归档旧 session，再创建新 replan session 并写入 `generationState.plannerSessionId`。
- 测试补齐：并发幂等、B 阶段阻断 C、D 阶段 retry/redesign、D 解析失败降级 stop、开关关闭旧链路回归。
- 消除 dispatcher 对 `IncrementalPlanningService` 的 `as any` 私有方法调用，改为显式 public 协作接口。
- `advanceOnce` 在 `idle -> generating` 后复用已声明状态，不再进行二次 `findById` 读取，缩小 phaseGenerate 前的 race window。
- `retryCurrentTask` 新增重试上限前置校验，超过 `maxRetries/maxTotalFailures` 时直接拒绝 retry。
- `buildPreTaskContext/buildPostTaskContext` 增加 JSON-only 强约束前后缀，降低非 JSON 响应导致的降级频率。
- `EventEmitterModule.forRoot()` 已上移到 `AppModule` 根注册，避免编排模块承担全局事件总线初始化职责。

## 双通道推进实现

### 通道 A：内部直调

- `PlanManagementService.startGeneration/generateNext` 在开关开启时直接调用 `stepDispatcher.advanceOnce(planId)`。
- `stepDispatcher` 在阶段完成后通过 `setImmediate` 自动触发下一次推进。

### 通道 B：外部事件触发

- `OrchestrationController.advancePlan` 发布 `orchestration.advance.requested`。
- `OrchestrationEventListenerService` 订阅事件并转发到 `stepDispatcher.advanceOnce`。

## 幂等控制

- Dispatcher 维持进程内 `activePlannings` 锁，避免同进程重复推进。
- 阶段状态写入使用 Mongo compare-and-set（`findOneAndUpdate` + `generationState.currentPhase/currentTaskId` 条件）做相位跃迁幂等。
- 当 compare-and-set 不命中时当前推进会静默退出，避免覆盖已被其他触发源推进后的状态。

## 关键状态字段

`OrchestrationGenerationState` 已扩展：

- `currentPhase`: `idle | generating | pre_execute | executing | post_execute`
- `lastDecision`: `generate_next | stop | redesign | retry`
- `plannerSessionId`
- `currentTaskId`

对应 schema 位于：`backend/src/shared/schemas/orchestration-plan.schema.ts`。

## Planner Session 与阶段协作

- 调度器首次推进时调用 `agentClientService.getOrCreatePlanSession` 建立 planner session。
- A/B/D 阶段通过 `PlannerService` 的 `sessionContext.sessionId` 复用同一 session。
- 终态时归档 planner session。

## 新增 Planner 阶段接口

`PlannerService` 新增能力：

- `generateNextTask(planId, context, { sessionId })`
- `executePreTask(planId, taskContext, sessionId)`
- `executePostTask(planId, executionResult, sessionId)`

## SSE 与后端事件

- SSE 新增：`planning.task.pre_executed`、`planning.task.post_processed`。
- 后端事件新增：`orchestration.task.pre_executed`、`orchestration.task.post_processed`、`orchestration.plan.completed`、`orchestration.plan.failed`。

## 灰度开关

- 环境变量：`ORCH_STEP_DISPATCHER_ENABLED`
- 值为 `1/true/yes/on` 时走新 dispatcher 链路；否则继续走旧 incremental loop。
