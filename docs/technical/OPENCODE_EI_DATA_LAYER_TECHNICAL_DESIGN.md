# OpenCode 执行数据分层与 EI 同步技术设计

## 1. 设计目标

1. 支持 Agent 与 `opencode serve` 交互执行研发任务。
2. 保持运行链路稳定与可恢复，不因分析需求污染执行主路径。
3. 为“研发成本、效率、惊喜度评估”提供可追溯、可重算的数据底座。

## 2. 关键结论

采用 **双层数据架构**：

- `apps/agents`：运行事实层（OLTP）
- `apps/engineering-intelligence`：分析层（OLAP/分析明细）

并采用 **最小运行态 + 完成后异步归档同步 + 补偿重放** 策略。

明细策略决策：

- EI 同步以“事件明细”为主（A 方案），作为成本/效率/惊喜度计算的事实数据源。
- 不以“仅汇总快照”作为主口径，避免后续指标不可重算。

## 3. 职责边界

### 3.1 Agents（运行事实层）

负责：

- run/session 生命周期控制
- 授权门禁（`permission.asked/replied/denied`）
- 运行状态可观测（phase/progress/blockingReason）
- 事件可靠投递（outbox/dead-letter/requeue/replay）

仅保留最小必需数据：

- `runId/sessionId/status/currentPhase/progress/blockingReason`
- `roleCode`
- `opencodeSessionId/opencodeTaskId`
- 关键审计字段（审批与控制动作）

执行前强校验：

- 角色准入：仅 `engineering`、`operations`、`technical-expert` 可发起 OpenCode 执行。
- 模型绑定匹配：执行请求模型需与 Agent 绑定模型一致（或命中显式 fallback 白名单）。
- 配额检测：按 `agentId + period` 配额校验，超限触发审批。

### 3.2 Engineering Intelligence（分析层）

负责：

- 接收 run 归档同步数据
- 存储事件明细与分析宽表
- 计算并提供成本/效率/惊喜度指标
- 提供分析查询与重算能力

## 4. 数据模型设计

## 4.1 Agents 扩展字段（建议）

在 `agent_runs` 增加：

- `executionChannel`：`native|opencode`
- `roleCode`：当前执行角色编码
- `externalSessionId`：`opencodeSessionId`
- `externalTaskId`：`opencodeTaskId`
- `sync`（对象）：
  - `state`：`pending|synced|failed`
  - `lastSyncAt`
  - `retryCount`
  - `nextRetryAt`
  - `lastError`
  - `deadLettered`
- `executionData`：
  - `provider`（opencode provider 标识）
  - `endpoint`（serve endpoint）
  - `boundModel`（agent 绑定模型快照）
  - `requestedModel`（本次请求模型）
  - `modelMatch`（`matched|fallback|rejected`）
  - `approvalState`（`not_required|pending|approved|rejected`）
  - `quota`（`period/limit/usedBefore/usedAfter/exceeded`）
  - `toolStats`（`toolCallCount/toolErrorCount`）
  - `costSnapshot`（`tokenIn/tokenOut/estimatedTotalCost/currency`）

## 4.2 EI 分析模型（建议）

### `ei_opencode_run_analytics`

run 级分析主表（宽表）：

- 基础：`agentId/runId/sessionId/opencodeSessionId/opencodeTaskId/roleCode`
- 时间：`startedAt/completedAt/durationMs`
- 成本：`tokenIn/tokenOut/modelCost/toolCost/estimatedTotalCost`
- 效率：`leadTime/cycleTime/waitMs/reworkCount/retryCount/firstPassSuccess`
- 质量：`testPass/buildPass/lintPass/humanTakeover`
- 价值：`surpriseScore/surpriseMeta`
- 同步：`sourceVersion/syncedAt/syncBatchId`

### `ei_opencode_event_facts`

事件明细表：

- `runId/eventId/sequence/eventType/timestamp`
- `stepId/toolCallId/approvalId`
- `payloadDigest`（脱敏摘要）
- `ingestedAt`

索引建议：

- 唯一：`(runId, eventId)`
- 顺序：`(runId, sequence)`
- 查询：`(agentId, completedAt)`、`(roleCode, completedAt)`

## 5. 同步流程设计

## 5.1 主流程（成功路径）

1. Agents 执行 OpenCode 任务并产生 Runtime 事件。
2. run 进入终态（`completed|failed|cancelled`）后，触发 EI 同步任务。
3. EI 接收并幂等落库：先全量事件明细（脱敏），再宽表计算。
4. Agents 更新 `sync.state=synced`。

执行前门禁流程（新增）：

1. 角色校验（研发/运维/技术专家）。
2. 模型绑定匹配检测（不通过则拒绝）。
3. `agent + period` 配额检测（超限则进入审批）。
4. 通过后才允许创建 OpenCode 会话并执行。

## 5.2 失败补偿

1. EI 接口失败：Agents 标记 `sync.state=failed` 并记录重试信息。
2. 定时补偿任务扫描 `sync.state=failed|pending` 进行重试。
3. 必要时通过 Runtime replay/outbox requeue 补齐缺失事件。

## 5.3 一致性策略

- 运行事实以 Agents 为准。
- 分析事实以 EI 为准（由 EI 统一计算口径）。
- 通过 `runId` 建立跨模块单一关联主键。

## 6. API 契约建议

### EI 写入接口

- `POST /engineering-intelligence/opencode/runs/sync`
  - 输入：run 基础信息 + 事件明细批次 + 成本原始字段
  - 约束：支持幂等写入（`runId` + `syncBatchId`）

补充（多环境）：

- 请求体必须携带 `envId` 与 `nodeId`，用于跨环境归因、冲突排查与节点治理。

#### 6.1 `runs/sync` 请求体（v1 草案）

```json
{
  "syncBatchId": "sync_20260312_001",
  "source": {
    "service": "agents",
    "version": "v1",
    "emittedAt": "2026-03-12T10:00:00.000Z"
  },
  "run": {
    "agentId": "agent_xxx",
    "roleCode": "engineering",
    "runId": "run_xxx",
    "sessionId": "session_xxx",
    "opencodeSessionId": "oc_s_xxx",
    "opencodeTaskId": "oc_t_xxx",
    "status": "completed",
    "startedAt": "2026-03-12T09:50:00.000Z",
    "completedAt": "2026-03-12T09:59:59.000Z",
    "durationMs": 599000
  },
  "costRaw": {
    "modelProvider": "openai",
    "modelName": "gpt-5.3-codex",
    "tokenIn": 12000,
    "tokenOut": 4800,
    "modelCost": 0.0,
    "toolCost": 0.0,
    "currency": "USD"
  },
  "events": [
    {
      "eventId": "evt_001",
      "sequence": 1,
      "eventType": "step.started",
      "timestamp": "2026-03-12T09:50:01.000Z",
      "stepId": "step_plan",
      "toolCallId": null,
      "approvalId": null,
      "payload": {
        "stepName": "planning",
        "phase": "planning"
      },
      "payloadDigest": {
        "outputSize": 120,
        "outputTruncated": false,
        "sensitiveMasked": true
      }
    }
  ],
  "stats": {
    "eventCount": 42,
    "stepCount": 7,
    "toolCallCount": 10,
    "approvalCount": 1,
    "retryCount": 0
  },
  "quota": {
    "period": "month",
    "limit": 100,
    "usedBefore": 80,
    "usedAfter": 81,
    "exceeded": false,
    "unit": "runCount"
  }
}
```

字段约束：

- `syncBatchId`：幂等键的一部分，建议全局唯一。
- `run.runId`：与 `syncBatchId` 组合做幂等；同批次重复写入必须返回幂等成功。
- `run.roleCode`：必传，用于角色维度分析与治理审计。
- `events`：必须按 `sequence` 升序；若乱序则 EI 侧拒收并返回错误码。
- `events[].eventId`：run 内唯一；用于去重。
- `events[].payload`：允许结构化扩展字段，但必须先脱敏。
- `events[].payloadDigest`：必传，至少包含 `sensitiveMasked`。
- `quota`：建议必传，用于配额超限审计与成本治理评估。

大小与限流建议：

- 单次 `events` 数量上限：`1000`。
- 单次请求体上限：`2MB`（可配置）。
- 超限时由 Agents 侧拆批（按 `sequence` 连续分片）并重试。

#### 6.2 `runs/sync` 响应体（v1 草案）

成功：

```json
{
  "ok": true,
  "runId": "run_xxx",
  "syncBatchId": "sync_20260312_001",
  "ingestedEvents": 42,
  "deduplicatedEvents": 0,
  "computed": true,
  "syncedAt": "2026-03-12T10:00:02.000Z"
}
```

幂等重复：

```json
{
  "ok": true,
  "idempotent": true,
  "runId": "run_xxx",
  "syncBatchId": "sync_20260312_001",
  "message": "batch already processed"
}
```

失败：

```json
{
  "ok": false,
  "errorCode": "EI_SYNC_SEQUENCE_GAP",
  "message": "events sequence must be continuous",
  "runId": "run_xxx",
  "syncBatchId": "sync_20260312_001",
  "retryable": true
}
```

建议错误码：

- `EI_SYNC_INVALID_PAYLOAD`
- `EI_SYNC_SEQUENCE_GAP`
- `EI_SYNC_DUPLICATE_EVENT_ID`
- `EI_SYNC_ORG_SCOPE_DENIED`
- `EI_SYNC_INTERNAL_ERROR`

## 6.3 配额与审批接口建议

- `GET /engineering-intelligence/opencode/quotas/agents/:agentId?period=day|week|month`
  - 返回当前周期配额、已用额度、超限状态。
- `PUT /engineering-intelligence/opencode/quotas/agents/:agentId`
  - 更新 agent 周期配额策略（仅管理角色）。
- `GET /engineering-intelligence/opencode/quotas/approvals?agentId=&period=&status=`
  - 查询超额审批记录。

### EI 查询接口

- `GET /engineering-intelligence/opencode/runs/:runId/analysis`
- `GET /engineering-intelligence/opencode/metrics/overview`

### EI 重算接口

- `POST /engineering-intelligence/opencode/runs/:runId/recompute-metrics`

## 7. 指标口径原则

1. 成本口径统一在 EI 计算，不在 Agents 侧固化报表逻辑。
2. 效率指标可重算（基于事件明细重放）。
3. 惊喜度评分必须可追溯到输入字段与基线版本。

## 8. 安全与合规

1. 原始 payload 落库前必须脱敏（token/password/secret 等）。
2. 明细事件默认保留结构化字段与脱敏 payload；超大输出采用 `outputPreview/outputSize/outputTruncated`。
3. 同步与查询接口复用 Gateway 签名上下文做调用方隔离与鉴权。

说明：当前系统按单租户运行，预算与审批治理不依赖 organization 维度，统一按 `agent + period` 控制。

多环境补充：

1. 边缘环境（local/ecds）不直接写中心分析核心库，只允许调用 Ingest API。
2. 每个边缘节点使用独立 `nodeId + 签名凭证`，支持吊销与轮换。

## 9. 风险与应对

1. 终态后一次性同步丢失风险
   - 应对：保留 Agents 最小运行事实 + 失败重试 + 重放补偿。
2. 双库口径不一致风险
   - 应对：指标仅由 EI 产出，Agents 不做分析口径计算。
3. 数据量增长风险
   - 应对：事件明细按时间分区、冷热分层、归档策略。

## 10. 实施步骤（建议）

1. 扩展 Agents run 字段与同步状态机。
2. 在 EI 新增同步接收与分析表。
3. 打通终态触发同步与补偿重试。
4. 上线 run 级分析查询接口。
5. 增加重算能力与审计查询。

## 11. 验收标准

1. 任一 OpenCode run 终态后，可在 EI 查询到分析结果。
2. 同步失败可自动补偿并最终一致。
3. 指标重算结果可追溯、可复现。
4. 不影响 Agents 主执行链路的稳定性与延迟。

## 12. 当前实现对齐（2026-03）

1. EI 同步接口 `POST /engineering-intelligence/opencode/runs/sync` 已落地。
2. Ingest 接口 `POST /engineering-intelligence/opencode/ingest/events` 与节点验签骨架已落地。
3. `ei_opencode_event_facts` 与 `ei_opencode_run_analytics` 已落地并接入幂等/顺序校验。
4. Agents 侧已接入 run 终态异步同步、失败重试、死信重投与 run 级 replay 补偿。
