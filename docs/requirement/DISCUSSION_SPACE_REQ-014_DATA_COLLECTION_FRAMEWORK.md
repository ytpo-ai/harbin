# Requirement: DISCUSSION_SPACE_REQ-014_DATA_COLLECTION_FRAMEWORK

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-014 |
| 所属 Feature | [PROJECT_INCUBATION](../feature/PROJECT_%20INCUBATION.md) |
| 所属 Plan | [DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | done |
| 创建日期 | 2026-04-30 |
| 最后更新 | 2026-04-30 |

## 2. 需求描述

### 2.1 背景

行业观察类孵化项目需要定期采集结构化数据（如 DeFi TVL、交易量、公司动态等）。当前 EI 服务没有数据源管理和采集数据存储的能力，需要建立完整的数据采集框架，与编排调度系统集成。

### 2.2 目标

1. 新增 `ei_data_sources` 集合，管理数据采集目标的配置
2. 新增 `ei_data_records` 集合，存储采集到的结构化数据
3. 数据源创建时自动关联 `orchestration_schedule`，驱动定期采集
4. 新增 MCP 工具供 Agent 写入采集记录
5. 前端数据看板页面展示数据源状态和采集数据

### 2.3 验收条件

- [x] `ei-data-source.schema.ts` 定义完成（含 config/collectFrequency/scheduleId/statistics 等）
- [x] `ei-data-record.schema.ts` 定义完成（含 data/rawData/collectedAt/dataCategory/tags 等）
- [x] 数据源 CRUD API 完整实现（POST/GET/PUT/DELETE + test + collect）
- [x] 数据记录查询/聚合/删除 API 完整实现
- [x] 创建数据源时自动创建对应的 `orchestration_schedule`
- [x] Schedule 执行时能触发 Agent 采集并写入 `ei_data_records`
- [x] MCP 工具 `data-collection.write-record` 和 `data-collection.get-source-config` 实现
- [x] 前端 `DataDashboard.tsx` 页面完成（数据源管理 + 数据看板 + 时间筛选）
- [x] 孵化项目详情页可导航到数据看板
- [x] 数据源健康度监控（成功率、最近错误）

## 3. 技术方案摘要

详见 Plan 文档 [§4 Phase 3](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md)

### 影响范围

- **后端**：EI 服务新增 2 个 Schema、2 个 Service、2 个 Controller、2 个 MCP 工具
- **前端**：新增 `DataDashboard.tsx` 页面及相关子组件
- **数据库**：新增 `ei_data_sources` 和 `ei_data_records` 两个集合
- **API**：新增约 10 个端点
- **编排/调度**：自动创建 Schedule，与现有调度系统集成

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-014_DEVELOPMENT.md) | 已创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 工作量较大，建议 MVP 阶段先支持 `api` 类型数据源，后续再扩展 `rss`/`web_scrape`
- 采集 Agent 需要具备 HTTP 请求和数据解析能力，可能需要专门的采集 Agent 角色
- 数据源的 `config.headers` 中可能含有 API Key，需通过 `api-keys` 模块引用，不直接明文存储
- 依赖 Phase 1（孵化项目连接）和 Phase 2（讨论转需求）完成
- 数据源创建需提供 `executorAgentId`，用于定时调度投递到指定 Agent 执行采集
