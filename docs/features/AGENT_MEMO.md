# Agent Memo（长期记忆）

## 目标

- 为 agent 提供长期记忆能力，沉淀简历、TODO、历史任务、草稿与主题知识。
- Memo 更新支持自动版本快照，主文档维护 `version` 递增。
- 使用 Redis 聚合缓存 + MongoDB 持久化 + Markdown 文档三层协同。
- 任务执行时按需优先读取 Redis（`memo:{agentId}:{memoKind}`），缓存缺失时回源 DB 并回填。
- **新增**：自动聚合 Agent 简历（Identity）和工作评估（Evaluation）文档

## 数据结构

- `memoKind`: `identity | todo | topic | history | draft | custom | evaluation`
- `memoType`: `knowledge | standard`
- `payload`: Object（专用扩展字段，如 `topic/taskId/status/toolCalls/period/sources`）
- 核心字段：`agentId`, `slug`, `title`, `content`, `version`, `tags`, `contextKeywords`, `source`
- 版本表：`AgentMemoVersion(memoId, version, content, changeNote, createdAt)`

## 文档类型

### Identity（简历）

- **用途**：Agent 的动态简历，包含角色、技能、任务履历等
- **数据源**：Agent 表、AgentSkill 表、OrchestrationTask 表
- **更新触发**：`agent.updated`、`agent.skill_changed`、定时任务
- **内容模板**：
  - Agent Profile（角色、类型、描述）
  - 技能矩阵（绑定技能、熟练度、统计）
  - 能力域（工具集、模型能力）
  - 工作风格（人格特质、学习能力）
  - 任务履历（近30天统计、最近完成任务）

### Evaluation（工作评估）

- **用途**：Agent 的工作绩效评估，包含工具使用、SLA指标等
- **数据源**：AgentRun 表、AgentPart 表
- **更新触发**：`task.completed`、定时任务
- **内容模板**：
  - 工具使用统计（使用次数、成功率）
  - SLA 响应指标（完成率、平均响应时间）
  - 质量指标

### TODO

- 任务清单管理
- 状态追踪：pending / in_progress / completed / cancelled

### Topic（主题积累）

- 按主题归类的运行时事件聚合
- 自动从 Redis 事件流聚合

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

### 事件驱动

- Redis key：`memo:event:{agentId}`
- Redis 缓存 key：`memo:{agentId}:{memoKind}`
- Redis 刷新队列 key：`memo:refresh:queue:{agentId}`
- 定时器：`MemoAggregationService` 每 `MEMO_AGGREGATION_INTERVAL_MS`（默认 60s）聚合

### 聚合服务

- **IdentityAggregationService**：聚合 Agent 简历
  - 从 Agent 表获取基础信息
  - 从 AgentSkill + Skill 表获取技能矩阵
  - 从 OrchestrationTask 表获取任务履历
- **EvaluationAggregationService**：聚合工作评估
  - 从 AgentRun 表获取 SLA 指标
  - 从 AgentPart 表获取工具使用统计

### 触发事件

- `agent.updated` - Agent 基础信息变更
- `agent.skill_changed` - 技能绑定变更
- `task.completed` / `orchestration.task_completed` - 任务完成
- 定时全量聚合（默认每天）

### 聚合结果

- Identity：`docs/memos/<agentId>/identity/identity-and-responsibilities.md`
- Evaluation：`docs/memos/<agentId>/evaluation/evaluation-<period>.md`
- Topic：按 `agent + topic` 归并到 `topic-*.md`
- 核心固定文档：`identity-and-responsibilities.md`、`todo-list.md`

## 文档落盘

- 目录：`docs/memos/<agentId>/<memoKind>/<slug>.md`
- 索引：`docs/memos/README.md`

## 前端管理

- 备忘录管理页默认只读查询，不提供手工创建入口。
- 页面内置"备忘录测试"右侧抽屉：可选择 agent 对话，并持续监测备忘录变化与聚合状态。
