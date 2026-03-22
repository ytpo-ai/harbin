# 用量与计费（Usage Billing）

## 1. 功能设计

- 目标：为 Agent 模型调用提供可追溯、可查询、可展示的计费能力。
- 数据结构：
  - 原始明细：`agent_messages.tokens` + `agent_messages.cost`
  - 定价来源：`models.dev` + `agent_model_registry.cost` 覆盖
  - 聚合快照：`agent_usage_daily_snapshots`
- 核心逻辑：
  - `ModelService.chat()` 统一补齐 cost。
  - Usage 聚合接口输出概览、趋势、按 Agent/按 Model 排行。
  - 前端 `/usage` 页面提供图表与定价状态面板。

## 2. 相关文档

- 规划文档：`docs/plan/USAGE_BILLING_SYSTEM_PLAN.md`
- 技术文档：`docs/technical/USAGE_BILLING_ARCHITECTURE.MD`
- Guide：`docs/guide/USAGE_BILLING_SYSTEM.MD`
- API 文档：`docs/api/agents-api.md`（Usage 模块章节）

## 3. 相关代码文件

- 后端：
  - `backend/apps/agents/src/modules/models/model-pricing.service.ts`
  - `backend/apps/agents/src/modules/models/model.service.ts`
  - `backend/apps/agents/src/modules/usage/usage.module.ts`
  - `backend/apps/agents/src/modules/usage/usage.controller.ts`
  - `backend/apps/agents/src/modules/usage/usage-aggregation.service.ts`
  - `backend/apps/agents/src/schemas/model-registry.schema.ts`
  - `backend/apps/agents/src/schemas/usage-daily-snapshot.schema.ts`
- 前端：
  - `frontend/src/pages/Usage.tsx`
  - `frontend/src/services/usageService.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/components/Layout.tsx`
