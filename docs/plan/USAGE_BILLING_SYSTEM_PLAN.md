# Usage 计费系统 Plan

## 背景与目标

- 背景：Message 改造已完成，`agent_messages` 已持久化 `tokens` (input/output/reasoning/cacheRead/cacheWrite/total) 和 `cost` 字段，但 `cost` 从未被实际填充（所有 provider 均未返回 cost）。Usage 数据管道已铺通，缺少定价源和计费逻辑。
- 目标：借鉴 OpenCode 的"外部源 + 本地缓存 + 配置覆盖 + 统一计费收口"模式，实现完整的 usage 计费能力，包括自动计费、用量聚合、API 和前端展示。

## 执行步骤

### Phase 1：定价源与计费收口（高优先级）

1. **新增 ModelPricingService**（`backend/apps/agents/src/modules/models/model-pricing.service.ts`）
   - 从 `models.dev/api.json` 拉取全量定价数据（104 providers / 3898 models）
   - 实现三层 fallback：ModelRegistry 手动覆盖 > 本地缓存文件 > 远程拉取
   - 启动时读本地缓存，异步拉取最新（不阻塞启动）
   - 每小时定时刷新，支持手动触发刷新
   - 本地缓存位置：`data/cache/models-pricing.json`

2. **扩展 ModelRegistry Schema**（`model-registry.schema.ts`）
   - 新增 `cost` 字段（全 optional）：`{ input, output, cache_read, cache_write, reasoning }`
   - 作为定价覆盖层，不填则 fallback 到 models.dev
   - 更新 model-management.service.ts 的 CRUD 和 toAIModel() 映射

3. **ModelService.chat() 统一计费收口**（`model.service.ts`，改动约 15 行）
   - provider 返回 cost 则直接使用
   - 否则通过 `modelPricingService.getPricing()` + `calculateCost()` 本地计算
   - 下游 AgentExecutor → Persistence 链路零改动

### Phase 2：聚合与 API（中优先级）

4. **新增 UsageDailySnapshot Schema**（`usage-daily-snapshot.schema.ts`）
   - 按 (date, agentId, modelId) 维度聚合存储每日快照
   - 字段：tokens 汇总、totalCost、requestCount

5. **新增 UsageAggregationService**（`usage-aggregation.service.ts`）
   - 实时查询：对 `agent_messages` 做 MongoDB aggregation pipeline
   - 定时快照：每日凌晨 Cron 生成前日 snapshot
   - 支持多维度查询：按 agent / model / 时间范围 / 全局

6. **新增 Usage API Controller**（`usage.controller.ts`）
   - `GET /usage/overview` — 总花费、token 汇总、环比
   - `GET /usage/daily-trend` — 每日趋势数据
   - `GET /usage/by-agent` — 按 Agent 分组排行
   - `GET /usage/by-model` — 按模型分组排行
   - `GET /usage/pricing/status` — 定价源状态
   - `POST /usage/pricing/refresh` — 手动刷新定价

### Phase 3：前端页面（中优先级）

7. **安装 recharts**，新增 `/usage` 路由和 Usage 页面
   - 概览卡片：本月总费用、总 Tokens、请求次数、活跃模型
   - 每日费用趋势图（Area Chart）
   - 按 Agent / 按 Model 用量排行（Bar Chart）
   - 定价源状态展示 + 手动刷新按钮
   - 加入侧边栏"系统管理"分组

### Phase 4：补充项（低优先级）

8. **历史数据回填脚本** — 按 tokens × pricing 补算 `agent_messages.cost`
9. **Budget 扩展** — 现有 `AgentBudgetConfig.unit` 扩展 `tokenCount` / `costUsd` 维度

## 关键影响点

- **后端 agents app**：新增 ModelPricingService、UsageAggregationService、UsageController；修改 ModelService.chat()、ModelRegistry Schema
- **前端**：新增 Usage 页面、usageService、recharts 依赖
- **数据库**：新增 `agent_usage_daily_snapshots` 集合；`agent_model_registry` 新增 `cost` 字段
- **外部依赖**：models.dev/api.json（通过缓存兜底，不强依赖运行时可达性）

## 风险与依赖

- models.dev 可用性：通过本地缓存 + 启动时 fallback 兜底，不依赖运行时必须可达
- 国产模型覆盖度：月之暗面、百川等可能在 models.dev 缺失，需 ModelRegistry 手动覆盖
- 历史数据缺口：现有 `agent_messages.cost` 全为空，需回填脚本补算
- 聚合性能：数据量大时实时聚合可能较慢，daily snapshot 机制缓解
