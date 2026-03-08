# Orchestration Scheduler 模块建设计划

## 背景

当前系统已有 `orchestration_plan + orchestration_task` 的一次性编排执行能力，但缺少“按时间周期自动触发”的调度能力，无法支持如“每 2 小时检查状态”这类长期任务。

本次建设目标：新增独立 `orchestration_schedule` 模块，统一管理定时计划；并扩展 `orchestration_task` 支持 `mode=plan|schedule`，复用现有执行链路，避免重复造轮子。

## 优化后的方案结论

1. 新增独立模型 `orchestration_schedule`，专职表达“什么时候触发、触发谁、触发什么输入”。
2. `orchestration_task` 增加 `mode` 与 `scheduleId`，将一次执行记录统一沉淀到 task 层。
3. 调度层只负责“触发”和“并发控制”，执行层继续复用 `OrchestrationService` 既有任务执行能力。
4. 统一观测口径：schedule 看计划态，task 看执行态，前端可同时展示。

## 执行步骤

1. 设计并落地数据模型：新增 `orchestration-schedule.schema.ts`，扩展 `orchestration-task.schema.ts` 的 `mode/scheduleId` 字段。
2. 新增 Scheduler 模块（controller/service/dto），提供计划 CRUD、启停、手动触发、历史查询接口。
3. 引入 Nest Schedule（`@nestjs/schedule`），实现启动恢复与动态注册/注销调度任务。
4. 建立调度执行器：触发时创建 `mode=schedule` 的 task，并复用既有任务执行流程。
5. 增加并发与幂等保护：同一 schedule 在运行中禁止重入，可配置是否跳过或排队。
6. 新增前端“定时服务管理”页面与服务层，支持列表、创建、启停、手动触发、执行历史查看。
7. 补齐文档索引与 API 文档映射，确保 `features/plan/technical/api` 四层一致。
8. 完成质量验证：后端 lint/typecheck，前端 lint/build，关键服务单测。

## 关键影响点

- 后端：`orchestration` 模块、schema、调度引擎、执行器。
- 前端：新增 scheduler 页面、路由、导航入口、service/types。
- API：新增 `/orchestration/schedules/*` 接口族。
- 数据库：新增 `orchestration_schedules` 集合，`orchestration_tasks` 增量字段。
- 测试：新增 scheduler service/controller 测试及 task mode 兼容测试。
- 文档：更新 feature 索引与 scheduler 专项技术文档。

## 影响文件（计划）

### 后端新增

- `backend/src/shared/schemas/orchestration-schedule.schema.ts`
- `backend/src/modules/orchestration/scheduler/scheduler.module.ts`
- `backend/src/modules/orchestration/scheduler/scheduler.controller.ts`
- `backend/src/modules/orchestration/scheduler/scheduler.service.ts`
- `backend/src/modules/orchestration/scheduler/scheduler-dispatcher.service.ts`
- `backend/src/modules/orchestration/scheduler/dto/index.ts`
- `backend/src/modules/orchestration/scheduler/dto/*.dto.ts`

### 后端修改

- `backend/src/shared/schemas/orchestration-task.schema.ts`
- `backend/src/modules/orchestration/orchestration.module.ts`
- `backend/src/modules/orchestration/orchestration.service.ts`
- `backend/src/modules/orchestration/orchestration.controller.ts`
- `backend/src/app.module.ts`

### 前端新增

- `frontend/src/pages/Scheduler.tsx`
- `frontend/src/services/schedulerService.ts`

### 前端修改

- `frontend/src/App.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/types/index.ts`（如当前项目集中维护前端共享类型）

### 文档新增/修改

- `docs/technical/ORCHESTRATION_SCHEDULER_TECHNICAL_DESIGN.md`
- `docs/features/ORCHETRATION_SCHEDULER.md`（按现有命名风格）
- `docs/features/INDEX.md`
- `docs/api/agents-api.md`（补充 scheduler API）

## 风险与依赖

1. 时区与 cron 语义：需统一默认时区（建议 `Asia/Shanghai`）并在 API 入参明确可覆盖。
2. 重启恢复：服务重启后需从 DB 恢复 enabled 计划，避免漏触发。
3. 并发重入：同一计划触发间隔小于任务执行耗时时可能重入，必须有锁或原子状态检查。
4. 执行失败治理：需要标准化失败重试策略与失败记录字段，避免“黑盒失败”。
5. 兼容性：`orchestration_task` 增量字段必须兼容旧数据（默认 `mode=plan`）。

## 验收标准

1. 可创建“每 2 小时执行”的 schedule，并可启停、编辑、删除。
2. schedule 触发后可看到对应 `mode=schedule` 的 task 执行记录。
3. 服务重启后，启用中的 schedule 可自动恢复触发。
4. 前端可完整管理 schedule，并查看最近执行结果与时间。
5. lint/typecheck/build/test 均通过，无破坏现有 plan 模式流程。
