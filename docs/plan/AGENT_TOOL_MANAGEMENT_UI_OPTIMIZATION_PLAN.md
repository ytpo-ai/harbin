# Agent Tool Management UI Optimization Plan

## Goal

优化工具管理页面的信息架构与可读性：将“工具”和“调用日志”统一为 Tab 视图，移除 token 成本与执行时长相关展示，并突出更有价值的治理与审计信息。

## Scope

- 工具管理页（前端）Tab 结构与交互
- 工具列表展示字段与信息层级（前端）
- 工具执行日志列表展示字段（前端）
- 样式与响应式体验（前端）

## Plan

1. 梳理 `Tools` 页面现有结构、字段来源与日志页入口，设计统一的 `工具/调用日志` 双 Tab 承载方式。
2. 重构“工具”Tab 展示：强化 provider/namespace/type/schema 等关键元信息可视化，提升扫描效率。
3. 移除工具视图中的 token 成本与执行时间字段，并补充更有价值的信息（如调用次数、最近状态、最后调用时间等，基于现有接口可得字段）。
4. 重构“调用日志”Tab 展示字段，去掉 token 消耗信息，保留状态、时间、触发来源、参数/结果摘要等核心审计信息。
5. 完成样式一致性与移动端适配收口，执行前端自测并检查是否需要更新相关功能文档。

## Impact

- Frontend: `frontend/src/pages/Tools.tsx`
- Frontend service: `frontend/src/services/toolService.ts`（按需，仅类型/字段适配）
- Backend/API: 无接口变更，基于现有返回数据做展示优化

## Risks / Dependencies

- 日志和统计接口的字段完整度可能存在环境差异，需要前端做空值兜底与降级展示。
- 若部分“新增展示信息”后端暂未提供，需要以可推导字段替代，避免引入额外接口改造。
