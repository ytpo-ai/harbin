# Development: DISCUSSION_SPACE_REQ-014

## 1. 本次完成范围

本次开发完成了 REQ-014 的 MVP 主体能力，覆盖数据源管理、采集记录存储、基础看板展示与孵化项目入口串联。

## 2. 后端改动

### 2.1 新增 Schema

- `backend/apps/ei/src/schemas/ei-data-source.schema.ts`
  - 新增 `ei_data_sources` 集合
  - 支持 `sourceType/config/collectFrequency/cronExpression/scheduleId/statistics` 等字段
  - 增加索引：`{ projectId: 1, status: 1 }`、`{ scheduleId: 1 }`、`{ collectFrequency: 1, status: 1 }`

- `backend/apps/ei/src/schemas/ei-data-record.schema.ts`
  - 新增 `ei_data_records` 集合
  - 支持 `data/rawData/collectedAt/dataCategory/tags/status` 等字段
  - 增加索引：按 `dataSourceId/projectId/outlineSectionId` 的时间序查询优化

### 2.2 新增 DTO / Service / Controller

- DTO：`backend/apps/ei/src/dto/data-collection.dto.ts`
  - 数据源 CRUD、测试采集、手动采集、数据记录查询/聚合/清理的参数定义

- Service：
  - `backend/apps/ei/src/services/ei-data-sources.service.ts`
    - 数据源 CRUD
    - `POST /ei/data-sources/:id/test` 在线测试（api 类型）
    - `POST /ei/data-sources/:id/collect` 手动采集并落库数据记录
    - 创建数据源时自动创建 `orchestration_schedules` 并回写 `scheduleId`
    - 创建数据源要求 `executorAgentId`，调度执行时将任务投递给指定 Agent
  - `backend/apps/ei/src/services/ei-data-records.service.ts`
    - 数据记录列表查询
    - 聚合统计（`day/dataCategory/tag`）
    - 单条删除与批量清理

- Controller：
  - `backend/apps/ei/src/controllers/data-sources.controller.ts`
  - `backend/apps/ei/src/controllers/data-records.controller.ts`

### 2.3 模块注册

- 更新 `backend/apps/ei/src/app.module.ts`
  - 注册 `EiDataSource/EiDataRecord` schema
  - 注册 `EiDataSourcesController/EiDataRecordsController`
  - 注册 `EiDataSourcesService/EiDataRecordsService`

## 3. 前端改动

- 新增服务：`frontend/src/services/dataCollectionService.ts`
  - 封装数据源列表、手动采集、数据记录查询、聚合统计接口

- 新增页面：`frontend/src/pages/DataDashboard.tsx`
  - 数据源列表（状态、频率、最近采集、成功率、最近错误）
  - 手动采集触发按钮
  - 数据分类统计
  - 最近采集记录展示

- 路由接入：`frontend/src/App.tsx`
  - 新增 `/ei/incubation/:id/data`

- 孵化项目详情页接入：`frontend/src/pages/IncubationProjectDetail.tsx`
  - 增加“数据看板”Tab 与跳转入口

## 4. 验证结果

- 后端：`backend` 执行 `pnpm run build:ei` 通过
- 前端：`frontend` 执行 `pnpm run build` 通过

## 5. 未完成项

- 暂无（REQ-014 验收项已全部完成）

## 6. MCP 工具补充

- 新增工具：
  - `builtin.sys-mg.mcp.data-collection.get-source-config`
  - `builtin.sys-mg.mcp.data-collection.write-record`
- 代码位置：
  - `backend/apps/agents/src/modules/tools/builtin/data-collection-tool-handler.service.ts`
  - `backend/apps/agents/src/modules/tools/tool-execution-dispatcher.service.ts`
  - `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`
  - `backend/apps/agents/src/modules/tools/builtin-tool-definitions.ts`
