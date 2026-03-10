# Agent Memo 成绩/批评与 Topic 聚合暂停开发总结

## 1. 本次实现内容

- 新增标准备忘录类型：`achievement`、`criticism`。
- 更新 memo create/update 规则：
  - `achievement` 仅允许高管 / 人类专属助理 / HR 写入，agent 自写被拒绝。
  - `criticism` 允许高管 / 人类专属助理 / HR / agent 自写。
- 暂停 topic 自动聚合：事件 flush 时不再写入 topic memo，仅清理队列并记录日志。

## 2. 关键实现点

### 2.1 类型与模型

- 文件：`backend/apps/agents/src/schemas/agent-memo.schema.ts`
- 变更：扩展 `MemoKind` 与 schema enum，纳入 `achievement`、`criticism`。

### 2.2 业务规则与权限

- 文件：`backend/apps/agents/src/modules/memos/memo.service.ts`
- 新增：
  - `MemoActorContext` / `MemoMutationOptions`
  - `assertMemoWritePermission`（集中写权限校验）
  - `roleMatches`（角色别名兼容）
- create/update 入口接入写权限规则。

### 2.3 控制器上下文透传

- 文件：`backend/apps/agents/src/modules/memos/memo.controller.ts`
- 变更：
  - create/update 接口接收 `@Req`。
  - 从 `req.userContext` 提取 `employeeId`、`role` 并传入 memoService。

### 2.4 Topic 聚合暂停

- 文件：`backend/apps/agents/src/modules/memos/memo.service.ts`
- 变更：
  - 增加 `topicAggregationEnabled`（默认 `false`）。
  - `flushEventQueue` 在聚合关闭时仅丢弃事件，不执行 `mergeTopicEvents`。

### 2.5 前端展示适配

- 文件：
  - `frontend/src/types/index.ts`
  - `frontend/src/pages/Memos.tsx`
  - `frontend/src/pages/AgentDetail.tsx`
- 变更：补充 `achievement`、`criticism` 的类型、筛选项、分组与 badge 展示。

## 3. 测试与验证

- 文件：`backend/apps/agents/src/modules/memos/memo.service.spec.ts`
- 新增测试：
  - agent 写 `achievement` 被拒绝。
  - agent 写 `criticism` 允许。
  - topic 聚合暂停时 flush 仅清理队列，不落库 topic。
- 命令：`npm test -- memo.service.spec.ts`
- 结果：通过（7/7）。

## 4. 影响与后续建议

- 历史 topic 文档保持可读，不会被删除。
- 如后续需要恢复 topic 自动聚合，可通过 `MEMO_TOPIC_AGGREGATION_ENABLED=true` 启用。
- 若后续角色体系有新增，建议统一在 memo 权限匹配函数中补充映射，保持行为一致。

## 5. 后续补充（追加规则与类型约束）

- 强化类型约束：`memoKind=topic` 时，系统强制 `memoType=knowledge`。
- `achievement`/`criticism` 按单文档累积写入，不再覆盖历史内容。
- 新增记录时若已有历史内容，使用分割线 `—` 隔开后再追加。
- `memo_mcp_append` 工具提示词同步加入上述规则（topic 类型约束 + 追加分割线）。

## 6. 目标对象纠偏（targetAgentId）

- 修复 `append-memo` 目标写入参数：支持显式 `targetAgentId`（或参数中的 `agentId`），创建时按目标对象写入。
- 增加严格校验：
  - `memoType=standard` 必须显式带 `memoKind`。
  - `memoKind=topic` 时拒绝 `memoType!=knowledge`。
  - `memoKind=achievement|criticism` 时拒绝 `memoType!=standard`。
- 当传入 `memoId` 更新时，若 `memoId` 所属 agent 与 `targetAgentId` 不一致直接拒绝，防止串写。
