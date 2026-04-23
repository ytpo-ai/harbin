# Requirement: ORCHESTRATION_TASK_REQ-004_SUBTASK_SUPPORT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-004 |
| 所属 Feature | [任务编排](../feature/ORCHETRATION_TASK.md) |
| 所属 Plan | [计划执行追加任务指定执行者 & 补充任务](../plan/ORCHESTRATION_TASK_ADDTASK_ASSIGNEE_AND_SUBTASK_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | draft |
| 创建日期 | 2026-04-23 |
| 最后更新 | 2026-04-23 |

## 2. 需求描述

### 2.1 背景

当一个计划任务执行结果偏差时（如开发任务未产出 commit），用户希望能基于该任务创建一个"补充任务"（子任务），让执行者继续完成遗漏的工作。子任务创建的 commit 等产出应能作为父任务的输出。

当前任务模型是扁平的 Plan → Task[] 一对多关系，任务之间仅通过 `dependencyTaskIds` 表达前后置约束，没有父子层级关系。

### 2.2 目标

1. 支持为已有任务创建补充任务（子任务），通过 `parentTaskId` 字段建立父子关系
2. 子任务紧跟父任务排列，在任务列表中以缩进样式展示
3. 子任务完成后，其产出（output、commit 等）自动聚合到父任务的 result 中

### 2.3 验收条件

- [ ] `OrchestrationTask` schema 新增 `parentTaskId` 可选字段，带索引
- [ ] `OrchestrationRunTask` schema 同步新增 `parentTaskId`
- [ ] `AddTaskToPlanDto` 支持 `parentTaskId` 可选参数
- [ ] 后端 `addTaskToPlan()` 校验 parentTaskId 有效性（存在且属于同 plan）
- [ ] 指定 parentTaskId 时，子任务自动插入到父任务后面（在父任务及其已有子任务之后）
- [ ] 前端任务列表对 failed/completed 任务显示"创建补充任务"操作按钮
- [ ] 点击"创建补充任务"打开 AddTaskModal，自动带入 parentTaskId
- [ ] 任务列表中子任务以缩进样式展示，可识别其父任务
- [ ] 子任务完成后，其 result.output 追加到父任务的 result.output 中
- [ ] 查询任务列表时返回 parentTaskId 字段

## 3. 技术方案摘要

### 3.1 Schema 层

```typescript
// orchestration-task.schema.ts
@Prop({ type: String, required: false, index: true })
parentTaskId?: string;
```

### 3.2 DTO 层

```typescript
// AddTaskToPlanDto 新增
@IsOptional()
@IsString()
parentTaskId?: string;
```

### 3.3 后端 Service 层

- `addTaskToPlan()`：
  - 当 `parentTaskId` 有值时，校验父任务存在且属于同 plan
  - 计算插入位置：父任务及其已有子任务的最后一个之后
  - 子任务自动继承父任务的 `projectId`
- 新增产出聚合逻辑：
  - 在 `task-lifecycle.service.ts` 中，子任务 completed 时，将 output 追加到父任务 result

### 3.4 前端

- `AddTaskModal`：新增 `parentTaskId` hidden 字段
- 任务列表：
  - 对 failed/completed 任务增加"创建补充任务"菜单项
  - 子任务缩进展示，左侧增加连线或缩进标识
  - `parentTaskId` 作为分组依据

### 影响范围

- **后端/Schema**：`orchestration-task.schema.ts`、`orchestration-run-task.schema.ts`
- **后端/DTO**：`dto/index.ts`
- **后端/Service**：`task-management.service.ts`、`task-lifecycle.service.ts`
- **前端/组件**：`AddTaskModal.tsx`、`TaskList.tsx`（或 `SettingsTab.tsx`）
- **前端/Hooks**：`useTaskMutations.ts`
- **前端/Service**：`orchestrationService.ts`
- **数据库**：新增索引 `{ parentTaskId: 1 }`
- **API**：`POST /orchestration/plans/:planId/tasks` 请求体新增 `parentTaskId`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/ORCHESTRATION_TASK_REQ-004_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 依赖 REQ-003 的 AddTaskModal 改造（执行者选择 UI）
- 子任务与四阶段调度器（step dispatcher）的兼容需要注意：子任务是否参与自动推进，还是仅在手动触发时执行
- 产出聚合边界需明确：建议仅聚合 `result.output` 文本，不覆盖父任务的 `result.summary`
- 建议分两步实现：Step A = Schema + DTO + CRUD + 前端入口；Step B = 产出聚合 + 调度兼容
