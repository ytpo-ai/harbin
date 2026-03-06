# TODO/History Memo 内容与聚合优化开发总结

## 1. 需求回顾

本次优化聚焦 memo 任务域边界治理，目标如下：

1. `todo` 仅保留任务编排中的未执行任务。
2. `todo` 显式排除会议聊天内容。
3. `history` 记录已执行编排任务及状态轨迹。

## 2. 本次交付内容

### 2.1 计划文档落盘

- 新增：`docs/plan/TODO_HISTORY_MEMO_AGGREGATION_OPTIMIZATION_PLAN.md`
- 内容包含范围拆解、执行步骤、影响点、风险与验收方向。

### 2.2 功能文档更新

- 更新：`docs/features/AGENT_MEMO.md`
- 关键变更：
  - 明确 `todo` 仅接收 `orchestration_task`，拒绝 `meeting_chat`。
  - 新增 `history` 的执行态/终态归档职责。
  - 补充 TODO/History 聚合边界（主键、幂等键、路由规则）。

### 2.3 技术设计文档新增

- 新增：`docs/technical/TODO_HISTORY_MEMO_AGGREGATION_DESIGN.md`
- 关键设计：
  - 事件来源分类与过滤策略（`sourceType`）。
  - 状态归属映射（未执行 -> `todo`，执行及终态 -> `history`）。
  - 聚合流程（过滤、去重、分组、自动迁移、时间线沉淀）。
  - 一致性策略（幂等、乱序保护、回放重建）。
  - 验收标准与 API 查询口径建议。

## 3. 方案要点

### 3.1 统一状态口径

- `todo`：`pending` / `queued` / `scheduled`
- `history`：`running` / `success` / `failed` / `cancelled`

### 3.2 自动迁移机制

- 任务首次进入执行态（如 `running`）时，从 `todo` 自动出队并写入 `history`。
- 终态更新持续归档在 `history`，保留状态时间线。

### 3.3 聊天隔离

- `meeting_chat` 与其他非任务来源默认不进入任务聚合管道。
- 防止会议对话污染任务备忘录。

## 4. 风险与后续建议

- 风险：历史事件保留策略与查询性能可能需要分层优化。
- 风险：若上游状态命名扩展，需要同步维护状态映射表。
- 建议：落地代码时优先上线过滤+迁移，再上线重放修复工具。

## 5. 关联文档

- 计划文档：`docs/plan/TODO_HISTORY_MEMO_AGGREGATION_OPTIMIZATION_PLAN.md`
- 功能文档：`docs/features/AGENT_MEMO.md`
- 技术文档：`docs/technical/TODO_HISTORY_MEMO_AGGREGATION_DESIGN.md`
