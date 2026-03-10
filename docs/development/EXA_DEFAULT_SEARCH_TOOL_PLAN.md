# Exa 作为默认搜索工具开发总结

## 1. 实施结果

- 已新增显式 Exa 搜索工具：`builtin.internal.web.search.exa`。
- 已将 Composio SERP 搜索规范为：`composio.mcp.web.search.serp`。
- 已加入兼容映射：`internal.web.search` 与 `builtin.internal.web.search` 迁移到 `composio.mcp.web.search.serp`。
- 已保持工具调用结构兼容，执行结果保留 `provider/results/raw` 输出形态。

## 2. 代码改动

### 2.1 新增模块

- `backend/apps/agents/src/modules/tools/exa.service.ts`
  - 封装 Exa `/search` 调用
  - 默认参数：`type=auto`、`contents.highlights.max_characters=4000`
  - 环境变量读取：`EXA_API_KEY`

### 2.2 现有模块改造

- `backend/apps/agents/src/modules/tools/tool.module.ts`
  - 注入 `ExaService`

- `backend/apps/agents/src/modules/tools/tool.service.ts`
  - 新增/更新搜索工具 canonical id：`builtin.internal.web.search.exa`、`composio.mcp.web.search.serp`
  - 增加 legacy 到 canonical 的搜索工具迁移映射
  - 执行分发改为显式 Exa 路由与显式 SERP 路由
  - `searchLatestModels` 继续复用统一搜索策略

- `backend/apps/agents/src/modules/tools/web-tools.service.ts`
  - 新增 `performWebSearchExa` 与 `performWebSearchSerp` 显式执行方法

## 3. 配置与文档同步

- `backend/.env.example`
  - 新增 `EXA_API_KEY=your_exa_api_key_here`

- `docs/feature/AGENT_TOOL.md`
  - 更新 provider 接入描述：Exa 默认 + Composio 回退

- `docs/api/agents-api.md`
  - 补充默认搜索后端说明与 `data.provider` 说明

## 4. 验证

- 执行：`npm run build:agents`（backend）
- 结果：构建通过

## 5. 风险与后续建议

- 若未配置 `EXA_API_KEY`，将触发回退路径并依赖 Composio 可用性。
- 建议在部署环境中统一配置 `EXA_API_KEY`，并对搜索失败日志增加监控告警。
