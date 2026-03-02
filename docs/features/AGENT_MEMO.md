# Agent Memo（长期记忆）

## 目标

- 为 agent 提供长期记忆能力，沉淀知识、TODO 与专题积累文档。
- 运行时细粒度行为先进入 Redis 事件缓冲，再由后端定时聚合入库。
- 使用 Markdown 文档 + MongoDB 索引双存储，支持可读性与检索性能。
- 在任务执行时优先检索 memo 索引，按需渐进加载上下文。

## 数据结构

- `memoKind`: `identity | todo | topic`（长期文档种类）
- `memoType`: `knowledge | behavior | todo`（兼容语义字段）
- `todoStatus`: `pending | in_progress | completed | cancelled`
- 核心字段：`agentId`, `slug`, `topic`, `category`, `title`, `content`, `tags`, `contextKeywords`

## API（agents service）

- `GET /api/memos`：分页查询
- `POST /api/memos`：创建备忘录
- `PUT /api/memos/:id`：更新备忘录
- `DELETE /api/memos/:id`：删除备忘录
- `POST /api/memos/search`：按 agent + query 检索（支持渐进摘要）
- `POST /api/memos/behavior`：写入 Redis 事件流（不直接落库）
- `POST /api/memos/todos/upsert`：创建或更新任务 TODO
- `PUT /api/memos/todos/:id/status`：更新 TODO 状态
- `POST /api/memos/events/flush`：手动触发 Redis 聚合入库
- `POST /api/memos/docs/rebuild`：重建 Markdown 索引

## MCP 工具

- `memo_mcp_search`：检索记忆（可返回摘要或全文）
- `memo_mcp_append`：追加记忆条目（新建或追加到已有 memo）

## 聚合机制

- Redis key：`memo:event:{agentId}`
- 定时器：`MemoAggregationService` 每 `MEMO_AGGREGATION_INTERVAL_MS`（默认 60s）聚合
- 聚合结果：按 `agent + topic` 归并到 `topic-*.md` 长期文档
- 核心固定文档：`identity-and-responsibilities.md`、`todo-list.md`

## 文档落盘

- 目录：`docs/memos/<agentId>/<category>/<slug>.md`
- 索引：`docs/memos/README.md`
