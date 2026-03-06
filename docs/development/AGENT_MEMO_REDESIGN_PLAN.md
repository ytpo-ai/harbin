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

---

## 计划原文（合并归档：AGENT_MEMO_REDESIGN_PLAN.md）

# Agent Memo 重构实施计划

## 背景与目标

- 备忘录（Memo）作为系统 Agents 的长期记忆，直接影响 Agent 对环境的感知质量与任务完成效果。
- 当前 Memo 结构与使用方式无法完整承载新的记忆分层需求（简历/TODO/历史/草稿/自定义主题）以及版本化、Redis 优先读取策略。
- 本次重构目标是在保持可迁移、可回滚、可观测的前提下，建立统一的 Memo 数据模型与事件驱动更新链路。

## 需求范围（本次）

### 一、Memo 结构重构

1. 每个 Agent 默认维护以下核心 Memo 类别（`memoKind`）：
   - `identity`：简历备忘录（身份、职责、能力、关键任务）
   - `todo`：TODO 备忘录
   - `history`：历史任务摘要备忘录
   - `draft`：草稿备忘录（近期消息、工具调用）
   - `topic`：主题知识备忘录
   - `custom`：自定义主题备忘录
2. `memoType` 收敛为：
   - `knowledge`：知识记录
   - `standard`：标准备忘
3. 外层字段保持精简，类型专属数据统一放入 `payload`。

### 二、版本化能力

1. `AgentMemo` 增加 `version` 字段。
2. 每次更新 Memo 时自动生成历史快照（类似 git 提交历史）。
3. 新增 `AgentMemoVersion` 模型存储版本快照。

### 三、Redis 长期记忆缓存

1. Redis 缓存保存聚合后的 Memo 数据（非仅事件队列）。
2. Key 规范：`memo:{agentId}:{memoKind}`。
3. Agent 工作时按需查询 Redis（非全量预加载）。

### 四、触发机制

1. 使用 Event Bus + 异步队列驱动缓存更新。
2. 监听事件：
   - Agent 信息变更
   - AgentSkill 变更
   - Task 完成
3. 由异步消费者执行聚合与 Redis 回写，主链路仅做事件投递。

### 五、草稿生命周期策略

1. 草稿默认时间窗口：24 小时。
2. 草稿默认大小上限：1MB。
3. 以上参数支持前端单独配置并下发。

## 目标数据模型

### AgentMemo（重构后）

- `id`
- `agentId`
- `title`
- `slug`
- `content`（Markdown）
- `version`（number）
- `memoKind`（`identity | todo | topic | history | draft | custom`）
- `memoType`（`knowledge | standard`）
- `payload`（Object，类型专属扩展字段，不做严格结构约束）
- `tags`
- `contextKeywords`
- `source`

### AgentMemoVersion（新增）

- `id`
- `memoId`
- `version`
- `content`
- `changeNote`
- `createdAt`

## 执行步骤（按顺序）

1. **Schema 改造与索引设计**
   - 重构 `AgentMemo` schema 与枚举。
   - 新增 `AgentMemoVersion` schema 与索引（`memoId + version` 唯一）。
2. **服务层版本化能力改造**
   - Memo 更新前自动快照落库。
   - 主文档版本号原子递增。
3. **Redis 聚合缓存落地**
   - 新增 `memo:{agentId}:{memoKind}` 聚合写入能力。
   - 增加缓存读取、失效与回源策略。
4. **Event Bus + 异步队列接入**
   - 定义 Memo 更新事件与载荷。
   - 在 Agent/Skill/Task 关键链路发布事件。
   - 队列消费者执行聚合更新与 Redis 回写。
5. **Agent 运行时读取链路改造**
   - `getTaskMemoryContext` 优先 Redis、缺失回源 DB 并回填缓存。
   - 根据任务场景按需加载 memoKind。
6. **迁移与兼容处理**
   - 旧字段迁移到 `payload`。
   - 初始化 `version=1`。
   - 兼容旧接口输入一段过渡窗口。
7. **测试与文档更新**
   - 覆盖版本快照、事件触发、缓存一致性、回源链路。
   - 更新 README、API 文档、开发文档。

## 关键影响点

- 后端/API（高影响）：Memo 核心模型、服务、控制器、事件总线、队列。
- 数据库（高影响）：Schema/索引变化、新版本表、数据迁移。
- Redis（高影响）：缓存键设计与聚合写入逻辑。
- 前端（中影响）：草稿策略配置、版本历史展示（如接入）。
- 测试与文档（中高影响）：需覆盖新关键路径并同步规范。

## 风险与依赖

- 并发更新导致版本冲突：需采用原子更新与幂等保护。
- 事件突发导致队列积压：需做同 Agent+Kind 聚合去重。
- 新旧字段共存过渡期复杂度上升：需明确迁移窗口与兼容边界。
- Redis 与 DB 的最终一致性时延：需回源兜底与健康监控。

## 验收标准

- AgentMemo 新 schema 生效且数据可读写。
- Memo 更新自动生成版本快照，版本号连续递增。
- Agent 读取记忆时可命中 Redis 聚合缓存并支持缺失回源。
- Agent/Skill/Task 变更可触发异步刷新对应 Memo 缓存。
- 草稿策略支持 24h / 1MB 默认值并可配置。
- 测试通过，文档完成更新。

## 进度记录

- [x] 需求讨论与结构确认
- [x] 计划文档落盘
- [x] Schema 与服务改造
- [x] Redis + Event Bus + 队列落地
- [x] 运行时读取链路改造
- [ ] 测试与文档更新
