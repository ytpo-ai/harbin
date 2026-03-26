# RD Conversation Chat & Events 页面优化开发沉淀

## 背景

本轮针对 `研发会话（/rd-conversation）` 做了连续可用性与可读性优化，核心目标：

1. 解决 Events 面板无数据或观测困难问题
2. 解决 Chat 原始 JSON 直出、频繁刷新导致不可读问题
3. 精简页面头部交互，去掉 Agent 依赖，改为 Project 驱动
4. 提供便捷入口测试 OpenCode SSE 链路

## 变更总览

### 1) Events 加载与过滤链路修复

- 扩展 `sessionId` 与 `projectPath` 解析字段，兼容 `sessionId/sessionID/session_id` 及 `properties.info/part/status` 多层结构
- SSE 订阅支持透传 endpoint 配置（`endpoint/endpointRef/auth_enable`）
- 后端 SSE 订阅从固定配置改为可带运行时配置，避免连错 OpenCode 实例
- 放宽前端事件过滤：当选中 session 时，对无 `sessionId` 的事件不再直接丢弃

### 2) Events 面板可观测性优化

- 增加基于 `messages.parts` 的派生事件回填（`derived.*`），解决 SSE 暂无时 Events 空白
- 事件分组补充：`text/reasoning` 归入 `prompt`
- 事件默认折叠，仅显示标题；点击展开详情 JSON
- 事件分组从多列卡片改为 Tab：`TOOL / PROMPT / COMMAND / ERROR / OTHER`

### 3) Chat 渲染结构化改造

- 从原始对象直出改为块级渲染：`text / tool / meta`
- 工具调用支持深层参数提取（`input/args/arguments/params/parameters/payload/data/state.input`）
- 支持字符串 JSON 自动解析，并按 `toolCallId` 将 tool_result 的 input 回填 tool_call
- 消息排序与 key 稳定化，降低轮询重排抖动

### 4) Chat 交互优化

- 消息正文支持折叠（默认 10 行）
- 子消息列表（tool/meta）支持单独折叠
- user 消息右对齐并使用独立背景色（蓝色系），与 assistant 区分
- 发送框默认隐藏，右下角悬浮按钮唤起，支持关闭

### 5) 头部与项目选择区改造

- 移除页面内 Agent 选择与 Agent 同步项目能力
- Project 下拉改为仅使用 `sourceType=opencode` 项目列表
- 项目展示格式改为：`name(opencodeProjectPath)`，解决同名项目识别问题
- 在 Project 区域保留「测试 Opencode SSE」按钮，点击新开 tab 到 `/agent-task-runner`

### 6) 全局菜单调整

- 删除左侧菜单中的「Agent任务流」入口（保留路由可通过按钮跳转）

## 涉及文件

- `frontend/src/pages/RdConversation.tsx`
- `frontend/src/services/rdConversationService.ts`
- `frontend/src/components/Layout.tsx`
- `backend/apps/ei/src/controllers/opencode.controller.ts`
- `backend/apps/ei/src/services/opencode.service.ts`
- `backend/apps/ei/src/services/management.service.ts`
- `backend/apps/ei/src/services/opencode-client.service.ts`

## 验证

- 前端多轮构建验证：`frontend npm run build` 通过
- 后端 EI 构建验证：`backend npm run build:ei` 通过

## 当前效果

- Chat 区域可读性显著提升，不再以原始 JSON 为主
- Events 在 SSE 不完整场景下仍可通过派生事件观察执行轨迹
- 页面交互更聚焦于 OpenCode Project 与 Session，降低使用复杂度

## 后续建议

1. 为 Events Tab 增加未读标记（非当前 Tab 新增事件时提示）
2. 区分事件来源标签（`live` vs `derived`）
3. 为 SSE 连接态增加显式状态条（connected/reconnecting/error）
