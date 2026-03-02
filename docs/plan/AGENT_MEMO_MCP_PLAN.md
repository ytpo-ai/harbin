# Agent Memo MCP Plan

## 需求理解（更新）

- 运行时的细粒度行为事件不直接落库，而是先进入 Redis（短期记忆流）。
- 后端服务定时将 Redis 事件汇总为主题化长期记忆文档，再落到 `agent_memo`（Mongo）并同步 Markdown。
- `agent_memo` 一条记录对应一个长期主题 MD 文档，避免碎片化事件文档。
- 每个 agent 至少维护稳定文档集合：身份与职责、TODO 列表、专题知识沉淀（按 topic）。
- agent 处理任务前优先检索长期文档索引，并按需渐进加载正文内容。

## 执行步骤（更新）

- [ ] 重构 Memo 数据结构：引入 `memoKind=identity|todo|topic`，并用稳定 slug 表示长期文档。
- [ ] 新增 Redis 事件缓冲层：`memo:event:{agentId}`，支持追加、截断、TTL 与定时消费。
- [ ] 新增 Memo 聚合器服务（定时）：按 agent + topic 汇总事件，更新长期 MD 文档。
- [ ] 修改 Agent 运行时路径：只写 Redis 事件与 TODO 变更，不直接写碎片行为 memo。
- [ ] 调整检索逻辑：先返回文档索引摘要，再按需加载文档正文（渐进加载）。
- [ ] 前端改为“文档视角”管理：展示长期文档集合（身份/TODO/专题），支持编辑和筛选。
- [ ] 更新 README 与 docs（短期/长期记忆架构、Redis 聚合机制、检索策略）。

## 关键影响点

- backend: `apps/agents` 新模块、schema、服务编排、执行链集成
- api: 备忘录管理与检索接口新增
- frontend: 备忘录管理 UI、路由与导航扩展
- 测试: service 层单测与前后端基本回归
- 文档: README、docs 下功能说明与使用方式更新

## 风险与依赖（更新）

- Redis 不可用时需降级策略（允许临时丢弃事件，避免阻塞主流程）。
- 聚合任务需保证幂等，避免重复汇总导致文档内容膨胀。
- TODO 文档与 topic 文档并发更新时需防止覆盖（按段落追加 + 版本时间戳）。
