# Agents Web Tools Service Extraction Plan

## 背景与目标

- 将 `websearch`、`webfetch`、`content_extract` 的实现从 `tool.service.ts` 独立到单独文件。
- 保持现有工具 ID、参数校验、返回结构与执行行为不变，仅做服务拆分与依赖注入调整。

## 执行步骤

1. 在 `backend/apps/agents/src/modules/tools/` 新增 `web-tools.service.ts`，迁移三类工具实现及其依赖的私有辅助方法。
2. 在 `tool.module.ts` 注册新服务 provider，确保 Nest DI 可注入。
3. 在 `tool.service.ts` 注入 `WebToolsService`，将 `executeToolImplementation` 中对应分支改为委托调用。
4. 从 `tool.service.ts` 清理已迁移的方法与不再需要的 import，避免重复实现与无效依赖。
5. 运行类型检查/测试验证拆分后行为一致，确认无编译错误与运行时注入错误。

## 影响范围

- 后端：`apps/agents` tools 模块结构与依赖注入
- 测试：工具执行路径（web search/fetch/content extract）
- 文档：若涉及代码文件清单变化，补充更新功能文档

## 风险与应对

- 风险：辅助方法迁移遗漏导致行为变化。
  - 应对：连同 `extractCleanText`、`extractHtmlTitle`、搜索结果归一化方法一并迁移。
- 风险：Nest provider 未注册导致注入失败。
  - 应对：同步更新 `tool.module.ts` 并执行本地类型/构建检查。
