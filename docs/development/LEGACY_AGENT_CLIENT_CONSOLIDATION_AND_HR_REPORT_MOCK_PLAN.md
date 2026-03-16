# Legacy Agent Client Consolidation And HR Report Mock

## 1. 背景与目标

- 现状：`backend/src/modules` 中存在 `agents-client`、`models-client`、`tools-client` 三个并行客户端模块，职责边界分散。
- 目标：将 `models-client`、`tools-client` 能力收敛到 `agents-client`，减少重复网关封装与模块装配复杂度。
- 补充修正：`HRService.generatePerformanceReport` 暂停对 agents 外部调用，改为返回稳定 mock 数据，避免错误实现影响业务流程。

## 2. 变更内容

### 2.1 客户端模块收敛

- 在 `AgentClientService` 中保留工具执行历史查询能力 `getToolExecutions`。
- 删除未被调用的 founder 模型查询能力（`getFounderModels`）及对应类型。
- 删除以下旧模块文件：
  - `backend/src/modules/models-client/model-client.module.ts`
  - `backend/src/modules/models-client/model-client.service.ts`
  - `backend/src/modules/tools-client/tool-client.module.ts`
  - `backend/src/modules/tools-client/tool-client.service.ts`
- 更新模块装配：`AppModule` 不再引入 `ModelClientModule`、`ToolClientModule`。

### 2.2 HR 报告逻辑修正

- `HRService.generatePerformanceReport` 移除对 agents 工具执行历史接口的依赖。
- 报告中的任务统计、工具使用、Token 消耗改为 mock 值返回。
- 仍保留员工存在性校验与员工绩效字段兜底逻辑（`codeQuality/collaboration/innovation`）。
- `HRModule` 移除 `AgentClientModule` 依赖。

## 3. 影响范围

- 后端客户端聚合：`backend/src/modules/agents-client/agent-client.service.ts`
- 后端主模块装配：`backend/src/app.module.ts`
- HR 模块：
  - `backend/src/modules/hr/hr.module.ts`
  - `backend/src/modules/hr/hr.service.ts`

## 4. 验证结果

- `npm run lint` 通过
- `npm run build` 通过

## 5. 后续建议

- 若需要恢复真实绩效计算，可在 `HRService` 中引入本地可控的数据源（任务/审计汇总表），逐步替换 mock 常量。
- 若后续新增更多跨域 agents API，可继续保持在 `AgentClientService` 统一收口，避免再次分裂客户端模块。
