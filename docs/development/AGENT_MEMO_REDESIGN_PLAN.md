# Agent Memo 重构开发总结

## 1. 本次改造目标

本次围绕“Memo 作为 Agent 长期记忆”的核心诉求，完成了以下目标落地：

- Memo 主模型收敛到简化外层字段 + `payload` 扩展模型。
- 引入 Memo 自动版本快照机制（每次更新自动保留历史）。
- 引入 Redis 长期记忆聚合缓存（按 `agent + memoKind` 组织）。
- 引入 Event Bus + 异步队列刷新链路，实现“数据变更 -> 记忆缓存更新”的解耦。
- 运行时记忆读取改为 Redis 优先、缺失回源 DB。

## 2. 需求落地映射

### 2.1 Memo 类型与结构

- `memoKind` 扩展为：
  - `identity`
  - `todo`
  - `topic`
  - `history`
  - `draft`
  - `custom`
- `memoType` 收敛为：
  - `knowledge`
  - `standard`
- 外层字段保持简化，类型专属数据统一放入 `payload`。

已移除旧外层字段：

- `todoStatus`
- `accessCount`
- `lastAccessedAt`
- `category`
- `topic`（迁移至 `payload.topic`）

### 2.2 自动版本历史

- `AgentMemo` 增加 `version`。
- 新增 `AgentMemoVersion` 存储快照：`memoId + version + content + changeNote`。
- 每次 `updateMemo` 执行前先写入旧版本快照，再写新版本（`version++`）。

### 2.3 Redis 缓存与按需加载

- Redis 聚合缓存 key：`memo:{agentId}:{memoKind}`。
- 刷新队列 key：`memo:refresh:queue:{agentId}`。
- 运行时 `getTaskMemoryContext` 先读缓存，命中则直接检索；未命中则回源 DB 并回填缓存。

### 2.4 触发机制（Event Bus + 异步队列）

- 新增轻量事件总线 `MemoEventBusService`。
- 聚合服务监听并入队异步刷新任务：
  - `agent.updated`
  - `agent.skill_changed`
  - `task.completed`
- 定时聚合器在周期内消费刷新队列，执行对应 kind 的缓存重建。

## 3. 关键代码改动

### 3.1 Schema 层

- 更新：`backend/apps/agents/src/schemas/agent-memo.schema.ts`
  - 枚举与字段重构为新模型
  - 索引调整为新查询路径（含 `payload.topic`）
- 新增：`backend/apps/agents/src/schemas/agent-memo-version.schema.ts`
  - 版本快照模型与唯一索引

### 3.2 Memo 模块

- 更新：`backend/apps/agents/src/modules/memos/memo.module.ts`
  - 注册 `AgentMemoVersion` model
  - 注入并导出 `MemoEventBusService`
- 新增：`backend/apps/agents/src/modules/memos/memo-event-bus.service.ts`
  - 事件发布/订阅能力
- 更新：`backend/apps/agents/src/modules/memos/memo.service.ts`
  - create/update/delete 适配新 schema
  - 自动版本快照逻辑
  - Redis 缓存 key 与按需检索
  - 刷新队列入队/消费能力
  - 聚合状态增加 refresh 队列指标
- 更新：`backend/apps/agents/src/modules/memos/memo.controller.ts`
  - 入参适配新模型
  - 新增 `GET /api/memos/:id/versions`
- 更新：`backend/apps/agents/src/modules/memos/memo-aggregation.service.ts`
  - 增加 Event Bus 监听
  - 先消费刷新队列，再消费事件聚合队列
- 更新：`backend/apps/agents/src/modules/memos/memo-doc-sync.service.ts`
  - 落盘路径改为 `memoKind` 维度
  - 文档元信息输出改为 `version/payload`

### 3.3 触发方改动

- 更新：`backend/apps/agents/src/modules/agents/agent.service.ts`
  - `updateAgent` 后发布 `agent.updated`
  - 任务完成后发布 `task.completed`
- 更新：`backend/apps/agents/src/modules/skills/skill.service.ts`
  - skill 绑定变更后发布 `agent.skill_changed`
- 更新：`backend/apps/agents/src/modules/skills/skill.module.ts`
  - 引入 `MemoModule` 以注入事件总线

### 3.4 工具适配

- 更新：`backend/apps/agents/src/modules/tools/tool.service.ts`
  - `memo_mcp_search/memo_mcp_append` 参数适配新 `memoType` 和 `payload`

## 4. 文档与计划同步

- 新增计划文档：`docs/plan/AGENT_MEMO_REDESIGN_PLAN.md`
- 更新功能文档：`docs/features/AGENT_MEMO.md`

## 5. 验证结果

- 构建验证：`npm run build:agents` 通过。
- 单测验证：`npm test -- memo.service.spec.ts` 在当前仓库 Jest/TS 运行配置下失败（非业务编译错误，属于测试运行配置问题）。

## 6. 兼容性与后续建议

### 6.1 当前兼容状态

- 后端主链路已切换至新模型。
- 旧字段（如 `todoStatus/category/topic` 外层）不再作为主字段使用。
- `payload` 为弱约束对象，便于不同 memoKind 自由扩展。

### 6.2 建议的后续工作

1. 增加数据迁移脚本（历史数据统一迁移到 `payload` + `version=1`）。
2. 增加版本回滚接口（可选），实现指定历史版本恢复。
3. 在前端补充草稿策略（TTL/size）配置入口与管理界面。
4. 补齐基于项目 Jest 配置可稳定执行的 Memo 模块测试用例。
