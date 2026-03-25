# system-meeting-monitor 计划可见性修复计划

> 状态：已过时（当前 Scheduler 不再以 plan 绑定为核心模型）
>
> 说明：`schedule.planId` 现为兼容字段，不作为调度触发或删除保护依据。

## 背景

当前 `system-meeting-monitor` 以内置 schedule 形式存在，但未稳定绑定 `orchestration_plan`，导致前端计划编排页（基于 plan 列表）不可见。

## 执行步骤

1. 梳理 `SchedulerService` 初始化链路，明确 `system-meeting-monitor` 的创建与更新路径。
2. 新增内置 plan 的幂等初始化逻辑：为系统会议监控创建稳定可追踪的 `orchestration_plan`。
3. 建立 schedule 与 plan 的显式关联（`schedule.planId`），并在启动时对历史数据自动补齐。
4. 调整 schedule 触发落库逻辑，将 `planId` 透传到执行任务，保证计划视角可追踪。
5. 验证前端计划编排页可见性与详情行为，补充相关文档索引说明。

## 关键影响点

- **后端**: `scheduler.service.ts` 初始化、调度触发与任务落库逻辑
- **数据库**: `orchestration_schedules` 新增/补齐 `planId` 关联字段
- **前端**: 计划编排页无需新增入口，依赖 plan 数据可见
- **文档**: 功能文档索引补充本次计划

## 风险与依赖

- 需要保证幂等，避免重复创建系统 plan。
- 历史数据迁移需在服务启动时自动收敛，避免人工干预。
- 计划统计字段可能不反映 schedule 执行次数，本次仅保证可见性与关联完整性。
