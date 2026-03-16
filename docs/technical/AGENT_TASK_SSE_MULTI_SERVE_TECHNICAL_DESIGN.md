# Agent Task SSE + Multi OpenCode Serve 技术设计

## 1. 文档目的

本文基于当前已落地 Runtime 能力，给出 Agent Task SSE 化与 Multi-Serve OpenCode API 接入方案，确保长任务执行稳定、实时可观测、断线可恢复。

## 2. 背景与问题

1. Agent Task 长推理阶段容易受 HTTP 超时、网关 idle timeout 影响。
2. 当前连接中断后中间事件易丢失，前端状态恢复成本高。
3. 系统接入多个 `opencode serve` 后，需要统一路由、会话粘性、健康治理与故障转移。

## 3. 设计目标

1. 执行与连接解耦：任务异步执行，SSE 仅用于观测。
2. 统一事件模型：对齐 Runtime 事件契约，避免双轨。
3. 支持续传：`Last-Event-ID` + sequence 补发。
4. 多 serve 治理：路由、粘性、限流、熔断、审计。

## 4. 现有能力复用

可直接复用：

1. `RuntimeOrchestratorService`：run 生命周期与 tool/llm 事件记录。
2. `RuntimePersistenceService`：run/message/part/outbox 持久化。
3. `HookDispatcherService`：可靠分发、flush、dead-letter、replay。
4. `RuntimeController`：run 控制接口（pause/resume/cancel/replay）。

复用原则：

- 不新建并行“任务事件中心”，SSE 直接消费 Runtime 事件序列。

## 5. 架构设计

### 5.1 组件

1. `AgentTaskController`
   - 创建任务、查询任务、取消任务、SSE 订阅。
2. `AgentTaskService`
   - 任务入库、幂等校验、入队。
3. `AgentTaskWorker`
   - 异步消费任务，驱动 Runtime run 执行。
4. `OpenCodeServeRouterService`
   - 多 serve 路由、粘性分配、健康检查。
5. `OpenCodeApiAdapter`
   - 与 OpenCode API 进行流式交互并输出标准事件。
6. `RuntimeSseStreamService`
   - 事件补发 + 实时推送 + 心跳。

### 5.2 执行链路

1. 前端 `POST /agents/tasks`。
2. 服务端创建 task（`queued`）并入队，立即返回 `taskId`。
3. Worker 拉取任务，调用 Runtime `startRun` 进入 `running`。
4. Worker 通过 Router 选择 serve，并由 Adapter 建立流式 API 调用。
5. 增量输出映射到 Runtime 事件（`llm.delta/tool.*`）。
6. 成功 `run.completed`，失败 `run.failed`，取消 `run.cancelled`。

### 5.3 观测链路

1. 前端订阅 `GET /agents/tasks/:taskId/events`。
2. SSE 服务读取 `Last-Event-ID`，先补发缺失事件。
3. 进入实时推送并定期发送 `heartbeat`。

## 6. API 设计

### 6.1 创建任务

- `POST /agents/tasks`

请求示例：

```json
{
  "agentId": "agent_xxx",
  "task": "请分析并修复构建失败",
  "sessionContext": {},
  "idempotencyKey": "task-20260316-001"
}
```

响应示例：

```json
{
  "taskId": "task_xxx",
  "runId": "run_xxx",
  "status": "queued"
}
```

### 6.2 查询任务

- `GET /agents/tasks/:taskId`

返回：`status/progress/currentStep/error/resultSummary/lastEventAt`。

### 6.3 SSE 订阅

- `GET /agents/tasks/:taskId/events`
- Header：`Last-Event-ID`（可选）

SSE Header：

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`

### 6.4 取消任务

- `POST /agents/tasks/:taskId/cancel`

## 7. 事件契约

统一事件 envelope：

```json
{
  "id": "evt_000123",
  "type": "status|progress|token|tool|result|error|heartbeat",
  "taskId": "task_xxx",
  "runId": "run_xxx",
  "sequence": 123,
  "timestamp": "2026-03-16T10:00:01.000Z",
  "payload": {}
}
```

映射关系：

1. `run.started/run.resumed` -> `status`
2. `run.step.started` -> `progress`
3. `llm.delta` -> `token`
4. `tool.pending/running/completed/failed` -> `tool`
5. `run.completed` -> `result`
6. `run.failed/run.cancelled` -> `error/status`

## 8. 数据模型与索引

### 8.1 task 集合（新增或扩展）

字段建议：

- `taskId/runId/agentId/userId`
- `status`：`queued|running|succeeded|failed|cancelled`
- `progress/currentStep`
- `idempotencyKey/inputDigest`
- `serveId`（粘性映射）
- `attempt/errorCode/errorMessage`
- `cancelRequested`
- `createdAt/startedAt/finishedAt/updatedAt`

索引建议：

- `userId + createdAt`
- `status + updatedAt`
- `idempotencyKey + userId` 唯一

### 8.2 事件序列（复用 runtime 事件）

关键约束：

- 幂等键：`eventId`
- 顺序键：`runId + sequence`
- SSE 续传以 `sequence` 连续补发为准

## 9. Multi-Serve 路由设计

### 9.1 Serve Registry

每个 serve 维护：

- `serveId/baseUrl/capabilities/models/region`
- `healthStatus`：`healthy|degraded|down`
- `maxConcurrency/currentConcurrency`
- `errorRate/latencyP95/lastHeartbeatAt`

### 9.2 路由算法

输入：`agentId/model/provider/envId/sessionId`。

策略：

1. 若 `sessionId/runId` 已绑定 `serveId`，直接命中（粘性优先）。
2. 否则在 `healthy` 集合按加权最少负载选择。
3. 若无 healthy，降级使用 degraded，并记录风险事件。

### 9.3 粘性与转移

1. 首次分配后将 `serveId` 写入 task/run 扩展字段。
2. 会话执行中禁止无条件迁移。
3. 仅在明确不可恢复错误时触发迁移，迁移需记录审计。

## 10. OpenCode API 交互模型

### 10.1 Adapter 抽象

- `runStream(request): AsyncIterable<OpenCodeEvent>`
- `cancel(runContext): Promise<void>`

### 10.2 流式处理

1. Adapter 建立流式 API 连接。
2. 每个 chunk 转为 Runtime 事件并持久化。
3. 错误按分类映射为 `retryable` 或 `fatal`。

### 10.3 取消与超时

1. cancel：优先调用 OpenCode cancel API。
2. step timeout：单次上游调用超时。
3. task timeout：总任务运行超时。

## 11. 续传与一致性

1. SSE 连接携带 `Last-Event-ID`。
2. 服务端解析对应 sequence，并查询 `sequence > lastSequence` 的事件补发。
3. 补发完成后切换实时流。
4. 客户端按 `eventId` 去重、按 sequence 顺序渲染。

一致性语义：

- at-least-once 投递，客户端去重保证幂等展示。

## 12. 重试与错误处理

错误分级：

1. 可重试：网络波动、上游 5xx、限流。
2. 不可重试：参数错误、鉴权失败、用户取消。

重试策略：

1. 指数退避（例如 1s/2s/5s）。
2. 最大尝试次数（例如 3 次）。
3. 每次重试写入 `log` 事件与 task `attempt`。

## 13. 前端接入设计

### 13.1 Hook 规范

`useAgentTaskSSE(taskId)`：

1. 管理连接状态（connecting/open/reconnecting/closed）。
2. 记录 `lastEventId`。
3. 指数退避重连 + 抖动。
4. 连续失败后降级轮询 `GET /agents/tasks/:taskId`。

### 13.2 UI 输出

1. 阶段与进度。
2. token 增量输出。
3. tool 调用日志。
4. 阻塞原因与取消操作。

## 14. 安全与权限

1. 任务级鉴权：仅任务拥有者或管理员可读取/取消。
2. 事件 payload 脱敏：过滤 `password/token/secret` 等敏感字段。
3. 节点与 serve 凭证最小权限，支持轮换和吊销。

## 15. 基础设施与运维

1. 代理与网关需提升 SSE 路径的读超时。
2. SSE 路径关闭响应缓冲或确保即时 flush。
3. LB idle timeout 大于 heartbeat 间隔。
4. 多实例依赖共享事件存储保证补发一致。

## 16. 可观测性与告警

核心指标：

1. `task_success_rate`、`task_p95_latency`。
2. `sse_disconnect_rate`、`reconnect_count`。
3. `event_replay_gap_count`、`duplicate_event_count`。
4. `serve_error_rate`、`serve_queue_depth`、`serve_health_status`。

告警建议：

1. 失败率超阈值。
2. 队列堆积持续增长。
3. 某 serve 异常下线或错误率飙升。

## 17. 灰度发布与回滚

### 17.1 灰度

1. 功能开关：`AGENT_TASK_SSE_ENABLED`。
2. 按 `agentId/userId` 白名单灰度。
3. 双轨对比期间保留旧查询路径。

### 17.2 回滚

1. 关闭开关回退旧执行观测方式。
2. 保留 task/run/event 数据用于复盘与补偿。

## 18. 验收标准

1. 单任务长时执行（>=20 分钟）稳定。
2. 断线重连后可补发并恢复状态。
3. 多 serve 下同 run 粘性路由正确。
4. 取消、超时、重试结果与状态一致。
5. 关键指标可观测、告警可触发。

## 19. 相关文档

- `docs/plan/AGENT_TASK_SSE_MULTI_SERVE_PLAN.md`
- `docs/feature/AGENT_RUNTIME.md`
- `docs/api/opencode-api.md`
