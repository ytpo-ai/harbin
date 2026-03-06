# Agent 页面 Session 查询开发计划

## 背景

在 Agent 详情页新增 Session 查询能力，用于查看该 Agent 的 session 内容，并提供更友好的可读展示，便于定位执行上下文与消息轨迹。

## 执行步骤

1. 梳理现有 runtime/orchestration session 数据流与前端入口，确认可复用接口与缺口。
2. 在 agents 服务补充按 Agent 查询 session 列表接口（按最近活跃时间倒序，支持分页）。
3. 在 gateway 侧补充 session 查询透传能力，供前端统一通过 `/api` 访问。
4. 在前端 `agentService`/`AgentDetail` 增加 Session 查询与详情加载逻辑（列表 + 按 sessionId 查询）。
5. 在 Agent 页面实现 Session 友好展示（基础信息卡、消息时间线、角色与状态标签、长文本折叠/展开）。
6. 联调并补充错误态/空态/加载态，确保无 session、session 不存在、接口异常时都有可理解反馈。
7. 更新 API 文档，补充 Session 查询相关端点与参数说明。

## 影响范围

- 后端/API：`agents runtime` 新增按 owner 查询 session 列表能力；gateway 增加对应透传接口。
- 前端：`AgentDetail` 新增 Session 查询与展示区域。
- 文档：`docs/api/agents-api.md` 增补 session 查询说明。

## 风险与依赖

- 历史 session 的 `messages` 结构可能存在字段不完整，前端需容错显示。
- 单条 session 消息量可能较大，需要前端做内容折叠，避免页面可读性下降。
- 需要保持与现有日志/备忘录页签交互一致，避免影响已有操作路径。
