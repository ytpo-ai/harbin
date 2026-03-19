# HR 解除 Task 依赖与 Tasks 模块下线计划

## 1. 背景

- 当前 legacy backend 存在 `modules/tasks` 旧模块（`/tasks`），前端未直接调用。
- `HRService` 仍注入 `TaskService`，形成 HR 对旧 tasks 模块的内部耦合。
- 目标是移除该耦合，并下线旧 tasks 模块及其数据定义，降低维护成本。

## 2. 执行范围

### In Scope

- 删除 HR 对 `TaskModule/TaskService` 的依赖。
- 删除 `backend/src/modules/tasks` 模块代码。
- 删除旧 tasks 的 schema 定义与关联装配。
- 清理受影响的共享类型引用并保持编译通过。
- 更新功能索引与当日日志。

### Out of Scope

- 不改造 orchestration/ei/agents 的现有任务体系。
- 不新增替代业务能力，仅做下线与解耦。

## 3. 具体步骤

1. 在 `HRService` 内移除 `TaskService` 注入，删除基于 `tasks` 集合的招聘建议逻辑。
2. 从 `HRModule` 删除 `TaskModule` 引用。
3. 从 `AppModule` 删除 `TaskModule` 装配。
4. 删除 `backend/src/modules/tasks/` 下 controller/service/module 文件。
5. 删除 `backend/src/shared/schemas/task.schema.ts`，并将仍需的执行任务类型改为独立共享类型（避免继续依赖旧 tasks 模块命名）。
6. 运行 lint/typecheck 做回归验证。
7. 更新 `docs/feature/INDEX.md` 与 `docs/dailylog/day/2026-03-16.md`。

## 4. 关键影响点

- 后端模块装配：`AppModule`、`HRModule`。
- HR 接口：`/hr/hiring-recommendations` 数据来源变化（不再基于旧 tasks backlog）。
- 共享类型：`AgentClientService`、`PlannerService` 任务入参类型命名调整。

## 5. 风险与应对

- 风险：若外部仍调用旧 `/tasks` 接口会 404。
  - 应对：确认该接口已不被前端使用，并在变更说明中标注为下线。
- 风险：删除旧 `Task` 类型后引发编译错误。
  - 应对：先替换为通用执行任务类型，再删除旧定义并全量检索。

## 6. 验收标准

- backend 中无 `modules/tasks` 代码与 `task.schema.ts` 文件。
- `HRService` 不再依赖 `TaskService`。
- `AppModule`/`HRModule` 不再引用 `TaskModule`。
- lint/typecheck 通过，且相关文档已更新。
