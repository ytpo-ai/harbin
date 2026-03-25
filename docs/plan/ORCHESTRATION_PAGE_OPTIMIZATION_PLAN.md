# [已弃用] ORCHESTRATION_PAGE_OPTIMIZATION_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration Page Optimization Plan

## Goal

优化计划编排页面信息架构：默认进入即展示 Plan 列表，将“创建计划”收敛为弹窗流程，并使用右侧抽屉承载计划详情，提升操作效率与上下文连续性。

## Scope

- 计划编排页面默认视图与主布局（前端）
- 创建 Plan 弹窗化交互（前端）
- Plan 详情右侧抽屉化展示（前端）
- 列表与详情联动、加载态与错误态一致性（前端）

## Plan

1. 盘点 `Orchestration` 页面现有结构与状态流，识别当前“新建/详情/列表”耦合点并拆分页面状态。
2. 调整页面首屏为 Plan 列表优先，确保进入页面默认可浏览与选择计划。
3. 将“创建计划”交互迁移到弹窗，复用原有校验与提交流程，提交成功后刷新列表并清理表单状态。
4. 将 Plan 详情改为右侧抽屉，从列表项点击打开，展示基础信息、任务明细与执行入口。
5. 收口并发交互状态（列表刷新、创建提交、详情加载）与空态/错误态反馈，避免状态串扰。
6. 完成前端自测，并检查相关功能文档是否需要更新。

## Impact

- Frontend: `frontend/src/pages/Orchestration.tsx`
- Frontend service: `frontend/src/services/orchestrationService.ts`（按需复用）
- Backend/API: 无新增接口，复用现有 Orchestration API

## Risks / Dependencies

- 详情抽屉展示依赖 `getPlanById` 返回字段完整度，需对缺失字段做前端兜底。
- 弹窗与抽屉并行交互需确保状态隔离，避免创建后详情与列表数据不一致。
- 快速切换计划详情时需防止请求竞态导致抽屉内容错位。
