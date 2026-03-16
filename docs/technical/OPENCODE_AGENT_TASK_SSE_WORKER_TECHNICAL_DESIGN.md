# OpenCode 长任务抗超时技术设计（Worker + SSE）

## 1. 文档目的

本文给出 OpenCode 长任务抗超时改造的详细技术设计，目标是让“任务执行”与“请求连接”解耦，实现：

1. 长时间推理稳定执行，不受短请求超时影响。
2. 前端实时可见执行过程，断线可恢复。
3. 执行状态可追踪、可补偿、可运维。

## 2. 现状问题

1. 任务执行与 HTTP 请求生命周期耦合，导致长任务易被网关或代理超时打断。
2. 前端仅做连接重试无法补齐中间事件，存在状态断层。
3. 缺少统一的任务状态机与事件续传协议，重连后一致性弱。

## 3. 目标与边界

### 3.1 目标

1. 引入异步任务 + Worker 执行模型。
2. 使用 SSE 作为事件分发通道，支持心跳与自动重连。
3. 提供 `Last-Event-ID` 续传补发，避免事件丢失。
4. 提供取消、超时、重试、幂等、防重复消费机制。

### 3.2 边界

1. 本期不引入独立前端工程，前端改造维持在 `frontend/`。
2. 本期不做分布式 run 锁重构。
3. 本期以 OpenCode 通道为主，不扩展其他执行引擎协议。

## 4. 总体架构

采用四层结构：

1. API 层（Nest）
   - 创建任务、查询状态、取消任务、SSE 订阅。
2. 调度执行层（Queue + Worker）
   - 异步执行 OpenCode 推理，产出过程事件。
3. 数据层（Mongo）
   - 持久化任务状态和事件序列。
4. 客户端层（React）
   - 订阅 SSE，断线重连，必要时降级轮询。

## 5. 核心流程

### 5.1 任务创建与执行

1. 前端调用 `POST /api/agent/tasks`。
2. 服务端创建 `agent_tasks`（`queued`），写入队列并返回 `taskId`。
3. Worker 消费任务后更新状态为 `running`。
4. Worker 调用 OpenCode（CLI JSONL 或 SDK 流）。
5. Worker 将增量输出映射为标准事件并写入 `agent_task_events`。
6. 任务结束写入 `result`/`error` 事件并落终态。

### 5.2 SSE 实时推送与续传

1. 前端订阅 `GET /api/agent/tasks/:taskId/events`。
2. 服务端优先根据 `Last-Event-ID` 回补缺失事件。
3. 回补结束后进入实时流推送。
4. 服务端定时发送 `heartbeat`，客户端超时则自动重连。

### 5.3 取消与超时

1. `POST /api/agent/tasks/:taskId/cancel` 标记取消请求。
2. Worker 检测到取消标记后中断执行（优先温和中断）。
3. 超过任务总时长上限触发系统超时终止。

## 6. API 设计

### 6.1 创建任务

- `POST /api/agent/tasks`

请求体：

```json
{
  "agentId": "agent_xxx",
  "prompt": "...",
  "sessionContext": {},
  "idempotencyKey": "req-20260316-001"
}
```

响应体：

```json
{
  "taskId": "task_xxx",
  "status": "queued",
  "createdAt": "2026-03-16T10:00:00.000Z"
}
```

### 6.2 查询任务

- `GET /api/agent/tasks/:taskId`

返回当前状态、进度、结果摘要、错误信息、时间戳。

### 6.3 订阅事件（SSE）

- `GET /api/agent/tasks/:taskId/events`
- Header 支持：`Last-Event-ID: evt_000123`

SSE 头建议：

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`

### 6.4 取消任务

- `POST /api/agent/tasks/:taskId/cancel`

返回 `cancelRequested=true` 与当前状态。

## 7. 数据模型设计

### 7.1 agent_tasks

建议字段：

- `_id`（taskId）
- `userId`
- `agentId`
- `status`：`queued|running|succeeded|failed|cancelled`
- `progress`：`0-100`
- `attempt`
- `idempotencyKey`
- `inputDigest`
- `resultRef`
- `errorCode`
- `errorMessage`
- `cancelRequested`
- `createdAt/startedAt/finishedAt/updatedAt`

索引建议：

- `userId + createdAt`
- `status + updatedAt`
- `idempotencyKey + userId`（唯一）

### 7.2 agent_task_events

建议字段：

- `_id`（eventId）
- `taskId`
- `seq`（递增序号）
- `type`
- `data`
- `createdAt`

索引建议：

- `taskId + seq`（唯一）
- `taskId + createdAt`
- TTL 索引（按保留周期）

## 8. 事件协议设计

统一 envelope：

```json
{
  "id": "evt_000123",
  "type": "token",
  "taskId": "task_xxx",
  "seq": 123,
  "ts": "2026-03-16T10:00:01.000Z",
  "data": {
    "text": "partial output"
  }
}
```

事件类型：

1. `status`：状态变化（queued/running/...）
2. `progress`：阶段与百分比
3. `token`：文本增量
4. `log`：过程日志（脱敏）
5. `result`：最终结果
6. `error`：失败详情
7. `heartbeat`：连接保活

## 9. Worker 与 OpenCode 交互模型

优先采用 CLI 子进程流式协议（JSONL）：

1. Worker `spawn(opencode, args)` 启动执行。
2. 监听 `stdout` 每行 JSON，映射事件并写库。
3. 监听 `stderr` 生成 `log/error` 事件。
4. 取消时发送 `SIGTERM`，超时后升级 `SIGKILL`。
5. 进程退出码映射为任务终态。

JSONL 示例：

```json
{"type":"status","phase":"thinking"}
{"type":"token","text":"Analyzing requirement..."}
{"type":"progress","value":48}
{"type":"result","content":"final answer"}
```

适配器抽象建议：

- `OpenCodeAdapter.runStream(task): AsyncIterable<OpenCodeEvent>`
- `OpenCodeAdapter.cancel(taskId): Promise<void>`

后续若切 SDK，仅替换 Adapter 实现。

## 10. 状态机与幂等

### 10.1 状态机

- `queued -> running -> succeeded`
- `queued|running -> failed`
- `queued|running -> cancelled`

禁止非法迁移，迁移失败应记录审计日志。

### 10.2 幂等策略

1. 任务创建使用 `idempotencyKey` 去重。
2. 事件写入使用 `taskId + seq` 唯一键防重复。
3. 客户端按 `event.id` 或 `seq` 去重渲染。

## 11. 重试与错误分类

### 11.1 错误分类

1. 可重试：网络抖动、上游 5xx、临时限流。
2. 不可重试：参数错误、权限错误、用户取消。

### 11.2 重试策略

1. 指数退避：`1s -> 2s -> 5s`（示例）。
2. 最大尝试次数：建议 `3`。
3. 每次重试更新 `attempt` 并写 `log` 事件。

## 12. SSE 保活与重连

### 12.1 服务端

1. 每 `10-15s` 发送 `heartbeat`。
2. 支持按 `Last-Event-ID` 补发历史事件。

### 12.2 客户端

1. 心跳超时建议 `30-60s`。
2. 重连采用指数退避 + 随机抖动。
3. 多次失败后降级轮询 `GET /tasks/:taskId`。

## 13. 基础设施配置要求

1. 反向代理需提高 `read timeout`（覆盖任务最大时长）。
2. 对 SSE 路径关闭或调优响应缓冲，确保事件及时下发。
3. 网关/负载均衡 idle timeout 需大于心跳周期。
4. 多实例场景使用共享事件存储保障续传一致性。

## 14. 安全与治理

1. 任务级鉴权：仅任务拥有者可查询/订阅/取消。
2. 事件脱敏：禁止输出密钥、凭证、敏感上下文。
3. 配额治理：用户并发任务上限、全局 Worker 并发上限。
4. 审计记录：任务创建、取消、失败重试、终态写入。

## 15. 可观测性

关键指标：

1. 任务：成功率、失败率、平均耗时、P95/P99。
2. 连接：SSE 建连成功率、断连率、重连次数。
3. 事件：补发次数、序列缺口率、重复事件率。
4. 队列：积压长度、消费速率、重试次数。

告警建议：

1. 失败率超过阈值。
2. 队列积压持续增长。
3. 心跳超时比例异常。

## 16. 发布与回滚策略

### 16.1 灰度发布

1. 增加开关：`OPENCODE_TASK_ASYNC_ENABLED`。
2. 先按 agent 或用户白名单灰度。
3. 逐步扩大流量并观测指标。

### 16.2 回滚

1. 关闭异步开关，回退到原执行路径。
2. 保留任务与事件数据以便复盘。

## 17. 测试与验收

### 17.1 测试建议

1. 单元测试：状态迁移、事件序列、幂等去重。
2. 集成测试：创建任务、SSE 订阅、断线重连、取消。
3. 稳定性测试：20 分钟长任务、网络抖动、代理重启。

### 17.2 验收标准

1. 长任务不中断，前端持续可见进度。
2. 断网恢复后补发成功，无明显事件丢失。
3. 取消与超时处理正确，状态一致。

## 18. 与现有文档关系

1. 本文补充 `Agent Runtime` 在 OpenCode 长任务执行场景下的执行与连接解耦实现。
2. 相关文档：
   - `docs/feature/AGENT_RUNTIME.md`
   - `docs/plan/OPENCODE_AGENT_TASK_SSE_WORKER_PLAN.md`
   - `docs/api/opencode-api.md`
