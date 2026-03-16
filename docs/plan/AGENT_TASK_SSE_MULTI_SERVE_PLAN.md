# Agent Task SSE 化与 Multi-Serve OpenCode 接入计划

## 1. 需求理解

- 当前 Agent Task 在长推理场景存在超时与状态断层风险，需要将执行链路升级为“异步执行 + SSE 实时观测”。
- 系统需要同时接入多个 `opencode serve`，希望采用 API 方式统一连接、路由、鉴权与治理。
- 方案需基于现有 Runtime 能力落地，避免重复建设并降低改造风险。

## 2. 目标与边界

### 2.1 目标

1. 将 Agent Task 统一改造为 SSE 事件输出，支持断线重连与续传补发。
2. 引入 Multi-Serve OpenCode API 路由层，支持会话粘性与健康治理。
3. 复用 Runtime 事件、Outbox、Run Control、Replay 机制，实现可恢复、可观测、可审计。

### 2.2 边界

1. 前端继续保留在主应用 `frontend/`，不新增独立前端工程。
2. 本期不做 Runtime 分布式锁重构。
3. 本期优先改造 OpenCode 执行通道与 Agent Task 观测通道，不扩展其他执行引擎。

## 3. 现状对齐（复用能力）

1. Runtime 已具备 run 生命周期事件（`run.*`、`llm.delta`、`tool.*`）。
2. Outbox 与 dead-letter/requeue/replay 已具备可靠分发与补偿能力。
3. Run 控制面已具备 `pause/resume/cancel/replay`。
4. Gateway 与审计链路已可承载内部签名上下文与调用追踪。

## 4. 执行步骤（按顺序）

1. 统一任务与事件契约
   - 定义 task 状态机、SSE 事件 envelope、错误码与续传规则。
   - 影响点：后端/API/前端。

2. 落地 Agent Task 异步执行 + SSE 通道
   - `POST /agents/tasks` 快速返回 taskId。
   - `GET /agents/tasks/:taskId/events` 提供 SSE（含 `Last-Event-ID`）。
   - 影响点：后端、前端、网关。

3. 落地 Multi-Serve API 路由与粘性
   - 新增 Serve Registry、Router、Health Probe。
   - run/session 首次分配后固化 `serveId`，保证会话粘性。
   - 影响点：后端、运维。

4. 适配 OpenCode API 流式执行
   - 通过 OpenCode API stream 获取增量输出并映射到 Runtime 事件。
   - 取消、超时、重试统一接入 runtime run 控制。
   - 影响点：后端、稳定性。

5. 前端改造与降级兜底
   - 新增 `useAgentTaskSSE` Hook：重连、去重、补发、降级轮询。
   - 影响点：前端、用户体验。

6. 可观测与灰度上线
   - 指标、告警、容量阈值与灰度开关落地。
   - 影响点：运维、发布流程。

## 5. 关键设计决策

1. 事件源统一以 Runtime 事件为准，不再新建平行事件体系。
2. SSE 作为任务观测默认通道；REST 负责创建、查询、控制。
3. OpenCode 与 Worker 交互优先 API 方式，CLI 仅保留兜底。
4. 多 serve 必须启用会话粘性（`sessionId/runId -> serveId`）。

## 6. 风险与依赖

1. 代理层若未调整超时与 buffering，SSE 可能出现假在线与延迟推送。
2. serve 切换策略不当会导致会话上下文错乱。
3. 补发逻辑若未严格按 sequence 校验，可能产生重复或乱序渲染。

## 7. 验收标准

1. 长任务（>=20 分钟）执行稳定，无请求级超时中断。
2. 断线重连后能基于 `Last-Event-ID` 补齐事件。
3. 同 run 在多 serve 场景保持粘性，避免错路由。
4. 取消、超时、重试行为与状态落库一致。
5. 指标可观测：任务成功率、SSE 断连率、重连次数、serve 健康与错误率。

## 8. 里程碑

### M1（协议与骨架）

- Task/SSE 契约、API 骨架、前端订阅 Hook 骨架。

### M2（执行与路由）

- OpenCode API Adapter、Multi-Serve Router、粘性映射、健康探测。

### M3（生产化）

- 续传补发、灰度开关、监控告警、故障演练与回滚预案。

## 9. 关联文档

- `docs/technical/AGENT_TASK_SSE_MULTI_SERVE_TECHNICAL_DESIGN.md`
- `docs/feature/AGENT_RUNTIME.md`
- `docs/api/opencode-api.md`

---

## 10. 会话追加计划（2026-03-16）：任务超时与重试策略

### 10.1 目标

1. 增加 step timeout 与 task timeout，避免长任务失控。
2. 增加可重试错误的指数退避（含 jitter）重试能力。
3. 在 SSE 事件流中补充 timeout/retry 可观测事件。

### 10.2 执行步骤

1. 扩展任务模型与接口返回字段
   - 新增 `stepTimeoutMs/taskTimeoutMs/maxAttempts/retryBaseDelayMs/retryMaxDelayMs/nextRetryAt/lastAttemptAt`。
2. Worker 接入超时控制
   - 执行链路增加 step 级超时守卫；任务级总超时统一阻断后续重试。
3. 重试决策与退避调度
   - 错误分类为 `retryable/fatal/cancelled`；仅 retryable 进入指数退避重试。
4. SSE 事件扩展
   - 输出 `retry_scheduled/retry_started/timeout` 语义（通过现有 envelope payload 承载）。
5. 前端观测补齐
   - 展示 attempt、nextRetryAt、timeout 原因。
6. 验证与文档更新
   - build 验证并同步更新 API/feature/dailylog 文档。
