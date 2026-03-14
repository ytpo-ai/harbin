# Plan D - Orchestration/Scheduler 重构（P1-P2）

## 1. 目标

压缩编排核心重复逻辑，修复 scheduler 职责越界与失败处理薄弱问题，提升调度可观测性与稳定性。

## 2. 范围与非目标

### 范围

- `backend/src/modules/orchestration/orchestration.service.ts`
- `backend/src/modules/orchestration/scheduler/scheduler.service.ts`
- 调度失败重试、退避、告警链路

### 非目标

- 不在本计划内做分布式锁替换（Plan F）
- 不在本计划内处理 requirement 状态闭环（Plan B）

## 3. 对应问题

- N-4（create/replan 重复）
- N-6（system schedule ensure 重复）
- N-12（memo timer 职责越界）
- N-13（调度失败无重试/死信）
- N-27（`dispatchSchedule()` 职责混合）

## 4. 前置依赖

1. 与运维确认告警接入方式（日志、Webhook 或监控平台）
2. 评估线上 schedule 数量与失败基线
3. 明确 API 兼容边界（返回结构、错误码）

## 5. 分阶段执行

### Phase D1 - orchestration 去重复

1. 提取 `_createTasksFromPlanningResult()`
2. `createPlanFromPrompt/replanPlan` 仅保留差异逻辑
3. 为共享方法补充单测

### Phase D2 - 领域职责下沉

1. 提取 `TaskClassificationService`
2. 提取 `TaskOutputValidationService`
3. 提取 `ExecutorSelectionService`

目标：`orchestration.service.ts` 从“混合实现”转为“流程编排 + 委派”。

### Phase D3 - scheduler 职责边界修复

1. 将 memo 聚合定时器迁移到 `MemoSchedulerService`
2. 提取 `SystemScheduleBootstrap`，统一 ensure 逻辑
3. 减少重复代码与硬编码

### Phase D4 - 调度失败治理

1. 拆解 `dispatchSchedule()`：锁、创建执行、结果处理、收尾
2. 增加失败重试策略（指数退避 + 最大重试）
3. 增加死信记录与告警

## 6. 问题映射表

| 问题 | 解决动作 | 核心文件 |
|---|---|---|
| N-4 | 提取共享任务创建流程 | `backend/src/modules/orchestration/orchestration.service.ts` |
| N-6 | 提取 system schedule bootstrap | `backend/src/modules/orchestration/scheduler/scheduler.service.ts` |
| N-12 | memo timer 迁出 scheduler | `backend/src/modules/orchestration/scheduler/scheduler.service.ts` |
| N-13 | 增加重试/退避/死信/告警 | `backend/src/modules/orchestration/scheduler/scheduler.service.ts` |
| N-27 | 拆解 dispatchSchedule 多职责 | `backend/src/modules/orchestration/scheduler/scheduler.service.ts` |

## 7. 验收标准（量化）

1. `createPlanFromPrompt/replanPlan` 重复块显著减少（核心流程共享）
2. scheduler 与 memo 职责边界明确（timer 不再挂在 scheduler）
3. 调度失败具备“可重试 + 可告警 + 可追踪死信”
4. API 行为与历史兼容，关键回归通过

## 8. 验证命令

在 `backend/` 执行：

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run build
npm run test -- --runInBand
```

## 9. 风险、灰度与回滚

### 风险

- 调度行为调整可能引发重复触发
- 告警配置不当可能导致噪音过高

### 灰度

- 先在低优先级 schedule 灰度重试策略
- 观察重复触发率、失败恢复率、告警噪音

### 回滚

- 保留旧 dispatch 分支开关（短期）
- 可快速关闭重试并退回单次执行模式

## 10. 执行进展（2026-03-14）

- [x] D1 完成：`createPlanFromPrompt/replanPlan` 已复用共享任务创建流程。
- [x] D2 完成：已下沉 `TaskClassificationService`、`TaskOutputValidationService`、`ExecutorSelectionService`。
- [x] D3 完成：memo timer 已迁出到 `MemoSchedulerService`；system schedule ensure 已统一到 `SystemScheduleBootstrapService`。
- [x] D4 完成：`dispatchSchedule()` 已拆分并接入指数退避重试、dead letter 记录、日志 + webhook 告警。
- [x] 模型补充：`orchestration_schedule` 新增 `lastRun.attempts` 与 `deadLetters[]`。
- [x] 验证通过：`npm run build`、`npm run test -- --runInBand`（backend）。
