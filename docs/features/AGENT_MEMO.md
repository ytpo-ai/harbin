# Agent Memo（长期记忆）

## 目标

- 为 agent 提供长期记忆能力，沉淀简历、TODO、历史任务、草稿与主题知识。
- Memo 更新支持自动版本快照，主文档维护 `version` 递增。
- 使用 Redis 聚合缓存 + MongoDB 持久化 + Markdown 文档三层协同。
- 任务执行时按需优先读取 Redis（`memo:{agentId}:{memoKind}`），缓存缺失时回源 DB 并回填。

## 数据结构

- `memoKind`: `identity | todo | topic | history | draft | custom`
- `memoType`: `knowledge | standard`
- `payload`: Object（专用扩展字段，如 `topic/taskId/status/toolCalls`）
- 核心字段：`agentId`, `slug`, `title`, `content`, `version`, `tags`, `contextKeywords`, `source`
- 版本表：`AgentMemoVersion(memoId, version, content, changeNote, createdAt)`

## API（agents service）

- `GET /api/memos`：分页查询
- `POST /api/memos/search`：按 agent + query 检索（支持渐进摘要）
- `GET /api/memos/:id/versions`：查看 memo 版本历史
- `POST /api/memos/behavior`：写入 Redis 事件流（不直接落库）
- `POST /api/memos/todos/upsert`：创建或更新任务 TODO
- `PUT /api/memos/todos/:id/status`：更新 TODO 状态
- `POST /api/memos/events/flush`：手动触发 Redis 聚合入库
- `GET /api/memos/aggregation/status`：查看 Redis 队列与聚合可观测状态
- `POST /api/memos/docs/rebuild`：重建 Markdown 索引

## MCP 工具

- `memo_mcp_search`：检索记忆（可返回摘要或全文）
- `memo_mcp_append`：追加记忆条目（新建或追加到已有 memo）

## 聚合机制

- Redis key：`memo:event:{agentId}`
- Redis 缓存 key：`memo:{agentId}:{memoKind}`
- Redis 刷新队列 key：`memo:refresh:queue:{agentId}`
- 定时器：`MemoAggregationService` 每 `MEMO_AGGREGATION_INTERVAL_MS`（默认 60s）聚合
- 聚合结果：按 `agent + topic` 归并到 `topic-*.md`，并刷新对应 kind 缓存
- 核心固定文档：`identity-and-responsibilities.md`、`todo-list.md`
- 触发事件：`agent.updated`、`agent.skill_changed`、`task.completed`（Event Bus -> 异步刷新队列）

## 文档落盘

- 目录：`docs/memos/<agentId>/<memoKind>/<slug>.md`
- 索引：`docs/memos/README.md`

## 前端管理

- 备忘录管理页默认只读查询，不提供手工创建入口。
- 页面内置“备忘录测试”右侧抽屉：可选择 agent 对话，并持续监测备忘录变化与聚合状态。
