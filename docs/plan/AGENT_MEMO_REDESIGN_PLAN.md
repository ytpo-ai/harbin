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
