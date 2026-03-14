# AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_D_ORCHESTRATION_SCHEDULER_REFACTOR 开发沉淀

## 1. 背景与目标

- 对齐 `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_D_ORCHESTRATION_SCHEDULER_REFACTOR.md`。
- 聚焦编排与调度链路的重复逻辑压缩、职责边界收敛、失败治理可观测性增强。
- 对应问题：N-4、N-6、N-12、N-13、N-27。

## 2. 本次落地范围

### 2.1 Orchestration 去重复（D1）

- 在 `orchestration.service.ts` 新增共享方法 `createTasksFromPlanningResult(...)`。
- `createPlanFromPrompt` 与 `replanPlan` 复用同一任务创建、依赖回填流程，仅保留差异逻辑。

### 2.2 领域职责下沉（D2）

- 新增 `TaskClassificationService`：任务分类（email/research/review/code）。
- 新增 `TaskOutputValidationService`：研究输出、审校输出、外部动作证明、代码执行证据校验。
- 新增 `ExecutorSelectionService`：执行者选择与邮件能力校验。
- `OrchestrationService` 从“混合实现”收敛为“流程编排 + 服务委派”。

### 2.3 Scheduler 职责边界修复（D3）

- 新增 `MemoSchedulerService`，承接 memo event/full aggregation 定时器生命周期管理。
- 新增 `SystemScheduleBootstrapService`，统一系统 schedule/plan ensure 逻辑（meeting monitor、engineering statistics）。
- `SchedulerService` 移除上述领域细节，聚焦调度注册与执行编排。

### 2.4 调度失败治理（D4）

- `dispatchSchedule()` 拆分为锁管理、启动标记、执行重试、结果回写、收尾释放。
- 新增失败重试（指数退避 + 最大重试）：
  - `SCHEDULER_MAX_RETRIES`
  - `SCHEDULER_RETRY_BASE_DELAY_MS`
  - `SCHEDULER_RETRY_MAX_DELAY_MS`
- 新增死信记录（schedule 维度）：`orchestration_schedules.deadLetters[]`。
- 新增告警链路：日志告警 + 可选 webhook（`SCHEDULER_ALERT_WEBHOOK_URL`）。

## 3. 数据模型与代码影响

- Schema 增量：
  - `orchestration_schedule.lastRun.attempts`
  - `orchestration_schedule.deadLetters[]`
- 新增文件：
  - `backend/src/modules/orchestration/services/task-classification.service.ts`
  - `backend/src/modules/orchestration/services/task-output-validation.service.ts`
  - `backend/src/modules/orchestration/services/executor-selection.service.ts`
  - `backend/src/modules/orchestration/scheduler/memo-scheduler.service.ts`
  - `backend/src/modules/orchestration/scheduler/system-schedule-bootstrap.service.ts`
  - `backend/test/orchestration/task-classification.service.spec.ts`
  - `backend/test/orchestration/task-output-validation.service.spec.ts`

## 4. 验证结果

- `npm run build`（backend）：通过。
- `npm run test -- --runInBand`（backend）：通过（9/9 suites，47/47 tests）。
- 增量 lint（本次改动文件）：通过。

## 5. 风险与回滚建议

- 风险：重试策略配置过大可能放大执行延迟与告警噪音。
- 建议：先在低优先级 schedule 灰度观察失败恢复率、重复触发率、死信增长速率。
- 回滚：将 `SCHEDULER_MAX_RETRIES=0` 可快速退回单次执行；关闭 `SCHEDULER_ALERT_WEBHOOK_URL` 可暂时静默 webhook 告警。

## 6. 关联文档

- 计划文档：`docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_D_ORCHESTRATION_SCHEDULER_REFACTOR.md`
- Review 文档：`docs/issue/AGENTS_ORCHESTRATION_CODE_REVIEW.md`
