# ORCHESTRATION SERVICE SPLIT RUNTIME

## 背景

- `backend/src/modules/orchestration/orchestration.service.ts` 历史上承载了编排模块的大部分业务逻辑。
- 为降低单文件维护成本并保持 Controller/API 零改动，已落地 Facade + 子 Service 的运行时结构。

## 当前实现结构（2026-03-23）

### Facade 入口

- `backend/src/modules/orchestration/orchestration.service.ts`
  - 对外保留原有 public 方法签名。
  - 将 Plan/Task/Run/SSE/上下文相关调用分别委派到 7 个子 Service。

### 执行引擎层

- `backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts`
  - 统一承接 task node / run task node 执行能力。
  - 已内建 async task 等待、research/review/external 校验与状态流转。
  - run task 执行新增 run 取消态检查（polling 前检查 run.status），命中取消时将当前 run_task 置为 `cancelled` 并停止后续执行。
  - 新增通用输出兜底校验：所有 runtime taskType 在成功前都会执行 `validateGeneralOutput()`，拦截 `TASK_INABILITY` / “无法执行”类结果。
  - `development` 代码执行证明校验支持 `CODE_VALIDATION_MODE`：
    - `warn`（默认）：记录 warning，不阻断完成；
    - `strict`：缺少代码执行证明时直接失败。

### 输出校验基线（2026-03-24）

- `backend/src/modules/orchestration/services/task-output-validation.service.ts`
  - 新增 `validateGeneralOutput()`，统一处理空输出与 inability 信号（含中英文 + `TASK_INABILITY:` 格式）。
  - `validateResearchOutput()` inability 词库改为正则，并扩展“我这边无法 / 当前会话没有 / 缺少.*工具”等模式。
- `backend/src/modules/orchestration/services/orchestration-context.service.ts`
  - `buildTaskDescription()` 统一追加 Task Output Contract，要求无法执行时必须输出 `TASK_INABILITY: <reason>`。

### Requirement 同步链路（2026-03-25）

- 编排模块已移除 requirement 相关 EI 直连（`/ei/requirements/*`）。
- 需求详情读取：`PlanningContextService` 通过提示词强制 planner/CTO agent 主动调用 `builtin.sys-mg.mcp.requirement.get`。
- 需求状态回写：`OrchestrationContextService` 通过提示词驱动 planner/CTO agent 主动调用 `builtin.sys-mg.mcp.requirement.update-status`。
- requirement 同步默认 fail-closed：工具调用失败会中断当前编排流程。

### 子 Service（7 个）

- `services/plan-management.service.ts`
- `services/task-management.service.ts`
- `services/plan-execution.service.ts`
- `services/task-lifecycle.service.ts`
- `services/plan-stats.service.ts`
- `services/plan-event-stream.service.ts`
- `services/orchestration-context.service.ts`

> 当前阶段进入“逐段下沉”阶段：
> - `plan-stats.service.ts`、`plan-event-stream.service.ts`、`orchestration-context.service.ts` 已迁移为独立实现，不再委派 legacy。
> - `plan-management.service.ts` 已迁移为独立实现（`createPlanFromPrompt/generatePlanTasksAsync/replanPlan/replanPlanAsync/list/get/update/delete`）。
> - `plan-execution.service.ts` 已迁移为独立入口实现（`runPlan/runPlanAsync/executePlanRun/listPlanRuns/getLatestPlanRun/getRunById/listRunTasks`）；run task node 执行由 execution engine 统一承接。
> - `plan-execution.service.ts` 已补齐 `cancelRun`：支持 run 级别取消、批量回写未完成 run_task 为 `cancelled`、并推送 `run.cancelled` SSE 事件。
> - `plan-management.service.ts` 新增生产态切换能力：`publishPlan`（planned -> production）与 `unlockPlan`（production -> planned）。
> - `task-management.service.ts` 已迁移为独立实现（`list/add/remove/update/reorder/batch/duplicate/draft` + 依赖环校验 + 可编辑状态校验）。
> - `task-lifecycle.service.ts` 已迁移为独立入口实现（`reassignTask/completeHumanTask/retryTask/debugTaskStep/executeStandaloneTask`）；debug/standalone 执行通过 execution engine 统一承接。
> - legacy 中已删除重复的 research/review/email 旧校验方法，统一走 `TaskOutputValidationService`/`TaskClassificationService`。

## 当前剩余复用点

- 新增 `services/orchestration-execution-engine.service.ts` 作为执行引擎适配层，统一承接对子 Service 的 task node / run task node 调用。
- `orchestration-execution-engine.service.ts` 已内建 `executeTaskNode` + `executeRunTaskNode` 主流程（含 async task 等待、research/review/external 校验、task/run-task 状态回写）。
- 各子 Service 已不再直接依赖 `OrchestrationLegacyService`；执行能力统一通过 execution engine 服务注入。
- `OrchestrationLegacyService` 已从模块 Provider 移除，且遗留文件 `orchestration-legacy.service.ts` 已删除。

## 模块装配

- `backend/src/modules/orchestration/orchestration.module.ts` 已注册：
  - `OrchestrationService`（Facade）
  - 7 个新子 Service
  - `OrchestrationExecutionEngineService`（执行引擎统一入口）

## 兼容性说明

- `OrchestrationController`、`SchedulerService` 等调用方无需改动。
- 外部 API 路由、入参、返回结构保持不变。
- SSE 的 stream 管理与快照推送已迁移到 `PlanEventStreamService`；执行链路由 `OrchestrationExecutionEngineService` 统一承接。
