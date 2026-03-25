# [已弃用] ORCHESTRATION_PLAN_LIST_DELETE_GUARD_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# 计划编排列表删除增强 Plan

## 需求概述
1. 计划编排列表增加删除按钮。
2. 点击删除先弹出确认提示。
3. 绑定了 schedule 的计划禁止删除，并弹出明确提示信息。

## 执行步骤

### 1. 前端：计划列表增加删除入口
- 在 `frontend/src/pages/Orchestration.tsx` 的列表操作列新增“删除”按钮。
- 保持与现有页面视觉风格一致，避免新增复杂交互依赖。

### 2. 前端：统一删除确认与提示流程
- 提取统一删除处理方法：先做绑定检查，再确认删除，最后执行删除。
- 点击删除时先弹窗确认，用户确认后再调用删除接口。

### 3. 绑定校验与错误兜底
- 前端删除前调用 `findSchedulesByPlanId` 进行预检查。
- 若存在绑定 schedule，直接提示“已绑定定时服务，无法删除”。
- 即使前端预检查通过，仍以后端 `deletePlan` 校验为准，并在失败时回显后端错误信息。

### 4. 文档与记录
- 更新 `docs/feature/ORCHETRATION_TASK.md` 的交互说明。
- 追加 `docs/dailylog/day/2026-03-17.md` 当日工作记录与影响范围。

## 关键影响点
- 前端页面：`frontend/src/pages/Orchestration.tsx`
- 前端服务：`frontend/src/services/schedulerService.ts`（复用，不新增接口）
- 后端：复用既有 `deletePlan` 绑定校验，无需新增接口
- 文档：功能文档与当日日志

## 风险与依赖
- 前端预检查与后端最终校验存在时间差，并发场景以后端返回为准。
- 若错误结构不统一，前端需兼容不同错误消息字段，保证提示可读。
