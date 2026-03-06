# TODO/History Memo 聚合技术设计

## 1. 目标与范围

本设计用于明确 Agent Memo 中 `todo` 与 `history` 的职责边界与聚合机制。

- `todo`：只记录任务编排中的未执行任务。
- `todo`：不记录会议聊天（meeting chat）内容。
- `history`：记录已执行的编排任务及状态。

## 2. 领域边界

### 2.1 事件来源分类

| sourceType | 说明 | 是否进入 todo/history |
|------------|------|-----------------------|
| `orchestration_task` | 任务编排系统产生的任务事件 | 是 |
| `meeting_chat` | 会议聊天消息事件 | 否 |
| `runtime_note` | 运行时普通备注事件 | 否（默认） |

### 2.2 状态分类

| 状态 | 含义 | 归属 |
|------|------|------|
| `pending` | 已创建，待执行 | `todo` |
| `queued` | 已入队，待调度 | `todo` |
| `scheduled` | 已排期，未开始 | `todo` |
| `running` | 执行中 | `history` |
| `success` | 执行成功 | `history` |
| `failed` | 执行失败 | `history` |
| `cancelled` | 已取消 | `history` |

> 规则：任务首次进入 `running`（或其他执行态）后，从 `todo` 自动移除，并转入 `history`。

## 3. 数据模型

### 3.1 任务事件模型（聚合输入）

```typescript
type TaskMemoEvent = {
  taskId: string;
  orchestrationId?: string;
  sourceType: 'orchestration_task' | 'meeting_chat' | 'runtime_note';
  status:
    | 'pending'
    | 'queued'
    | 'scheduled'
    | 'running'
    | 'success'
    | 'failed'
    | 'cancelled';
  title: string;
  priority?: 'low' | 'medium' | 'high';
  assigneeAgentId?: string;
  eventSeq?: number;
  eventAt: string;
  updatedAt: string;
  errorSummary?: string;
};
```

### 3.2 TODO 视图模型（聚合输出）

```typescript
type TodoMemoItem = {
  taskId: string;
  orchestrationId?: string;
  title: string;
  priority?: 'low' | 'medium' | 'high';
  status: 'pending' | 'queued' | 'scheduled';
  plannedAt?: string;
  updatedAt: string;
};
```

### 3.3 History 视图模型（聚合输出）

```typescript
type HistoryMemoItem = {
  taskId: string;
  orchestrationId?: string;
  title: string;
  startedAt?: string;
  finishedAt?: string;
  finalStatus: 'success' | 'failed' | 'cancelled' | 'running';
  errorSummary?: string;
  statusTimeline: Array<{ status: string; at: string }>;
  updatedAt: string;
};
```

## 4. 聚合流程

1. 事件进入聚合器后，先按 `sourceType` 过滤，仅保留 `orchestration_task`。
2. 通过幂等键（`taskId + eventSeq`，降级为 `taskId + updatedAt`）去重。
3. 使用 `taskId`（必要时加 `orchestrationId`）进行分组，更新任务最新状态。
4. 若最新状态属于未执行集合（`pending/queued/scheduled`），写入或更新 `todo`。
5. 若最新状态属于执行集合（`running/success/failed/cancelled`），从 `todo` 删除并更新 `history`。
6. 对 `history` 追加状态时间线，维护最终状态与关键时间字段。

## 5. 一致性与回溯

- 幂等：同一事件重复消费不会导致重复条目。
- 乱序保护：仅接受比现有版本更新的事件（按 `eventSeq` 或 `updatedAt` 比较）。
- 可回放：支持从任务事件日志重建 `todo` 和 `history` 视图。
- 修复策略：若发现状态异常，可执行指定时间窗口的重放修复。

## 6. API 与查询口径建议

- `GET /api/memos?memoKind=todo`：只返回未执行任务。
- `GET /api/memos?memoKind=history`：返回已执行任务与状态轨迹（可分页、可按时间过滤）。
- `POST /api/memos/todos/upsert`：仅允许 `sourceType=orchestration_task`。
- `PUT /api/memos/todos/:id/status`：状态更新时触发自动迁移（`todo -> history`）。

## 7. 验收标准

1. 会议聊天事件写入后，不会出现在 `todo` 或 `history` 任务列表。
2. 新建任务（`pending`）可在 `todo` 查询到。
3. 任务更新到 `running` 后，`todo` 中消失并进入 `history`。
4. 任务终态（`success/failed/cancelled`）在 `history` 中可见，且状态时间线完整。
5. 重复或乱序事件不会造成重复记录或状态回退。

## 8. 实施建议

- 先实现写入过滤与状态迁移规则，再补充回放重建工具。
- 为 `taskId`、`orchestrationId`、`updatedAt` 建立索引，提升聚合与查询效率。
- 在上线初期增加聚合审计日志，便于定位跨域数据污染（chat -> task）。
