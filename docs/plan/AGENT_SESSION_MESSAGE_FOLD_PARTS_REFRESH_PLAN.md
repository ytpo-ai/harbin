# Agent Session 消息展示优化方案

## 1. 背景与目标

- 当前 Agent Session 详情中的 message 正文直接完整展示，长内容可读性较差。
- 页面缺少单条 message 的 parts 数量与明细查看能力，不利于排查结构化消息。
- 需要在 Session 详情区域提供更直观的刷新入口，快速重载会话内容。

目标：

1. message 正文默认仅展示 5 行，超出可展开/收起。
2. 每条 message 展示 parts 数量，支持按条展开查看 parts 内容。
3. Session 详情区域增加刷新图标按钮，手动触发 session 内容重载。

## 2. 实施步骤

1. 在 `frontend/src/pages/AgentDetail.tsx` 增加 message 折叠状态管理与 key 生成逻辑。
2. 增加统一的 message 文本提取方法，兼容 `content/info/text` 等来源，避免空白渲染。
3. 增加 parts 提取方法，兼容 `parts/content.parts/metadata.parts/info.parts` 多来源结构。
4. 在消息列表渲染中接入 5 行折叠样式、展开按钮、parts 数量与 parts 明细面板。
5. 在 Session 详情抽屉头部增加刷新图标按钮，触发 `sessionDetailQuery.refetch`（并同步刷新列表）。
6. 本地自测：验证长文本折叠、parts 展开、刷新加载态与交互可用性。

## 3. 影响点

- 前端页面：`frontend/src/pages/AgentDetail.tsx`
- 前端交互：Session 抽屉消息渲染、刷新入口
- 测试与验证：UI 交互回归（长文本、parts、刷新）

## 4. 风险与处理

- 风险：后端不同链路返回的 message/parts 字段结构不一致。
- 处理：前端做多来源兜底解析，保证展示稳定。

- 风险：折叠样式在不同浏览器表现细节差异。
- 处理：使用 `-webkit-line-clamp` 与常规 overflow 组合实现，确保主流浏览器可用。
