# 工具管理 namespace/toolkit 对齐与搜索优化计划

> 会话目标：修复前端工具管理页面的 `namespace` 与 `toolkit` 选项未按技术文档更新的问题，并补充工具模糊搜索，隐藏“添加工具”按钮。

## 执行步骤

1. 对照 `docs/technical/TOOL_ID_NAMESPACE_FORMAT_OPTIMIZATION_DESIGN.md`，整理前端应展示的 namespace 固定字典与显示文案。
2. 改造 `frontend/src/pages/Tools.tsx` 的筛选选项与展示逻辑，确保 namespace/toolkit 与文档语义一致并兼容历史值。
3. 在工具列表新增关键词模糊搜索（不区分大小写），并与 provider/namespace/toolkit 筛选叠加生效。
4. 隐藏工具管理页“添加工具”入口，保留工具浏览与执行能力。
5. 运行前端 lint/build 验证变更，并检查是否需要补充功能文档描述。

## 影响范围

- 前端页面：`frontend/src/pages/Tools.tsx`
- 前端服务：`frontend/src/services/toolService.ts`（按需）
- 功能文档：`docs/feature/AGENT_TOOL.md`（按需）

## 风险与依赖

- 接口返回可能存在历史 namespace/toolkit 值，前端需提供展示层兼容映射，避免筛选失效。
- 模糊搜索基于前端内存过滤，若工具规模显著增大需评估进一步服务端搜索方案。
