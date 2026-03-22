# USAGE BILLING SYSTEM

## 模块边界

- `backend/apps/agents/src/modules/models/model-pricing.service.ts`
  - 负责模型价格加载、缓存、覆盖优先级与费用计算。
  - 数据源优先级：ModelRegistry `cost` 覆盖 > 本地缓存 > models.dev 远程拉取。
- `backend/apps/agents/src/modules/usage/usage-aggregation.service.ts`
  - 负责 usage 实时聚合、榜单查询、每日快照落盘。
  - 数据来源：`agent_messages`（assistant 消息）中的 `tokens` 与 `cost`。
- `backend/apps/agents/src/modules/usage/usage.controller.ts`
  - 对外暴露 usage 查询与 pricing 管理接口。
- `frontend/src/pages/Usage.tsx` + `frontend/src/services/usageService.ts`
  - 负责 `/usage` 页面展示、图表渲染与定价手动刷新。

## 关键链路

1. Agent 执行时，`ModelService.chat()` 调用 provider 获得 usage。
2. 若 provider 未返回 `cost`，则通过 `ModelPricingService.getPricing()` 获取单价并本地计算。
3. `cost` 与 `tokens` 继续沿用既有 runtime 持久化链路写入 `agent_messages`。
4. Usage 聚合服务基于 `agent_messages` 进行 overview/trend/rank 查询。
5. 每日快照写入 `agent_usage_daily_snapshots`，用于历史数据归档。

## 数据结构

- `agent_model_registry.cost`
  - 支持字段：`input/output/cache_read/cache_write/reasoning`。
  - 单位统一为 USD per 1M tokens。
- `agent_usage_daily_snapshots`
  - 聚合维度：`date + agentId + modelId`。
  - 指标：`tokens.*`、`totalCost`、`requestCount`。

## 运行与维护

- 模型定价缓存文件：`data/cache/models-pricing.json`。
- 定价刷新策略：启动加载缓存 + 异步远程拉取 + 每小时自动刷新。
- 手动刷新入口：`POST /usage/pricing/refresh`。
- 快照调度策略：服务启动后按小时巡检，确保昨日快照已生成。
