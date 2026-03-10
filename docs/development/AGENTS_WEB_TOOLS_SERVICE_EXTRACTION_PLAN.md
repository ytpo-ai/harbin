# Agents Web Tools Service Extraction 开发总结

## 1. 实施结果

- 已将 `websearch`、`webfetch`、`content_extract` 三类内置工具实现从 `tool.service.ts` 独立到单文件服务。
- `tool.service.ts` 现仅负责工具注册与执行分发，Web 工具逻辑通过依赖注入委托给新服务。
- 原有工具 ID、参数校验与返回结构保持兼容，未改变对外接口语义。

## 2. 代码改动

### 2.1 新增文件

- `backend/apps/agents/src/modules/tools/web-tools.service.ts`
  - 承载 `performWebSearch`、`performWebFetch`、`performContentExtract`
  - 承载 Web 搜索默认路由 `searchWebWithDefaultProvider`
  - 承载相关私有辅助方法（Exa/Composio 结果归一化、HTML 标题提取、文本清洗）

### 2.2 现有文件调整

- `backend/apps/agents/src/modules/tools/tool.service.ts`
  - 注入 `WebToolsService`
  - `executeToolImplementation` 的三类 Web 工具分支改为委托调用
  - `searchLatestModels` 改为复用 `WebToolsService.searchWebWithDefaultProvider`
  - 删除已迁移的 Web 工具实现与辅助方法，降低单文件复杂度

- `backend/apps/agents/src/modules/tools/tool.module.ts`
  - 注册并导出 `WebToolsService` provider，保证模块内可注入

- `docs/feature/AGENT_TOOL.md`
  - 更新 tools 相关代码文件清单，加入 `web-tools.service.ts`

## 3. 验证结果

- 执行命令：`npm run build:agents`（在 `backend/`，含 nvm 初始化）
- 结果：构建通过

## 4. 收益与后续建议

- 收益：`tool.service.ts` 职责更清晰，后续 Web 工具增强可在独立服务内迭代，降低回归风险。
- 建议：如后续继续拆分，可按同样方式将 meeting/memo/model 类工具逻辑逐步服务化，保持分发层稳定。
