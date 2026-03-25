# OpenCode 执行层 Step Timeout 活动感知改造 Plan

## 1. 背景

### 1.1 问题现象

编排系统通过 opencode 引擎执行开发/review 类型任务时，频繁触发 `STEP_TIMEOUT_EXCEEDED` 错误。opencode 中的真实开发任务（读代码、设计方案、写代码）通常需要 5-15 分钟，但系统在固定超时窗口到期后强制中断执行。

### 1.2 根因分析

当前架构存在**两层固定超时**互相竞争，且均不感知 opencode 的实际执行状态：

#### 层级 1: axios HTTP 请求超时（`promptSession`）

**文件**: `backend/apps/agents/src/modules/opencode/opencode.adapter.ts`

- `promptSession()` 向 opencode 的 `/session/{id}/message` 发送 HTTP POST 请求
- 这是一个**阻塞式等待** — opencode 在服务端完整执行完任务后才返回 HTTP 响应
- axios 超时由 `OPENCODE_MESSAGE_REQUEST_TIMEOUT_MS` 控制，**默认 120 秒**
- 在 opencode 执行期间，agents 服务收不到任何增量数据

```typescript
// opencode.adapter.ts:48-66
async promptSession(input, options?) {
  // 这个请求会阻塞直到 opencode 完成所有执行步骤
  const result = await this.request('POST', `/session/${input.sessionId}/message`, {
    data: { parts: [{ type: 'text', text: input.prompt }] },
    throwOnError: true,
    signal: options?.signal,
  });
  return { response: this.extractResponseText(result), metadata: result?.info || {} };
}
```

```typescript
// opencode.adapter.ts:241-255 — 超时解析
private resolveRequestTimeoutMs(route, runtime?, requestedTimeoutMs?) {
  // ...
  if (this.isMessageRoute(route)) {
    return this.messageRequestTimeoutMs;  // 默认 120s
  }
  return this.defaultRequestTimeoutMs;    // 默认 120s
}
```

#### 层级 2: worker step timeout（`withStepTimeout`）

**文件**: `backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts`

- `withStepTimeout` 是纯 `Promise.race` + `setTimeout`，固定时间窗口
- 不感知 opencode 是否在活跃执行中，到时间一律 reject
- 默认 120 秒（我们临时改为 opencode 通道 900 秒，但这只是权宜之计）

```typescript
// agent-task.worker.ts:415-436
private async withStepTimeout<T>(promise, timeoutMs, onTimeout): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          void onTimeout().catch(() => undefined);
          reject(new Error('STEP_TIMEOUT_EXCEEDED'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

#### onToken 回调时序问题

`opencode-streaming-agent-executor.engine.ts` 中的 `onDelta` 回调只在 `promptSession` 返回**之后**的 `collectSessionEvents` 阶段（`opencode-execution.service.ts:162-193`）才触发。在 opencode 执行的整个过程中，没有任何增量事件回传给 agents 服务。

#### 完整超时竞争链路

```
executeTaskWithStreaming() 被 withStepTimeout 包裹 (timer 1: stepTimeoutMs)
  │
  └─ opencode-execution.service.ts:executeWithRuntimeBridge()
       │
       ├─ adapter.promptSession()  ← 阻塞式 HTTP (timer 2: messageRequestTimeoutMs)
       │   └─ opencode 服务端执行 5-15 分钟...
       │   └─ axios timer 2 先到期 → ECONNABORTED / timeout
       │   └─ 或 timer 1 先到期 → AbortController.abort → STEP_TIMEOUT_EXCEEDED
       │
       ├─ collectSessionEvents()  ← 只有 promptSession 成功返回后才执行
       │   └─ onDelta 回调在这里触发（但已无机会）
       │
       └─ persistOpenCodeStepMessages()
```

---

## 2. 方案设计

### 2.1 核心目标

1. 在 opencode 执行期间，agents 服务能感知 opencode 的活跃状态
2. 只有在 opencode 真正无响应（死锁/崩溃）时才触发超时
3. 正常执行中的长时间任务不应被中断

### 2.2 方案选型

| 方案 | 描述 | 优点 | 缺点 | 推荐 |
|------|------|------|------|------|
| A: 流式改造 | 将 `promptSession` 改为 SSE 流式接收 | 根本性解决，实时感知 | 改动面大，需 opencode API 支持 SSE | 中长期 |
| B: 活动感知超时 | 轮询 opencode session 状态，有活动则重置计时器 | 改动适中，精确 | 需要 opencode 提供 session 状态 API | 推荐 ✅ |
| C: 延长固定超时 | 将超时设为 30-60 分钟 | 最简单 | 无法区分正常长任务和死锁 | 临时兜底 |

**推荐方案 B + C 兜底**：核心实现活动感知超时，同时设置合理的固定上限作为最终兜底。

### 2.3 详细设计

#### 2.3.1 opencode adapter 增加 session 状态查询

**文件**: `backend/apps/agents/src/modules/opencode/opencode.adapter.ts`

新增 `getSessionStatus` 方法，查询 opencode session 当前是否仍在执行中：

```typescript
async getSessionStatus(
  sessionId: string,
  runtime?: OpenCodeRuntimeOptions,
): Promise<{ active: boolean; lastActivityAt?: string }> {
  try {
    const session = await this.request<any>(
      'GET',
      `/session/${encodeURIComponent(sessionId)}`,
      { runtime, timeout: 5000 },
    );
    // opencode API 返回 session 对象，包含 messages 数组
    // 判断是否有正在执行的 assistant message（status 非 completed）
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const lastMessage = messages[messages.length - 1];
    const isActive = lastMessage && lastMessage.role === 'assistant'
      && (!lastMessage.status || lastMessage.status === 'pending' || lastMessage.status === 'running');
    return {
      active: Boolean(isActive),
      lastActivityAt: lastMessage?.updatedAt || lastMessage?.createdAt,
    };
  } catch {
    // 查询失败时假设仍在活跃（避免误杀）
    return { active: true };
  }
}
```

> **注意**：需要先确认 opencode 的 `GET /session/{id}` API 返回格式。如果 opencode 没有提供 session 状态查询 API，备选方案是使用 SSE 事件流 (`subscribeEvents`) 检测心跳。

#### 2.3.2 改造 `withStepTimeout` 为活动感知模式

**文件**: `backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts`

将 `withStepTimeout` 替换为 `withActivityAwareTimeout`：

```typescript
private async withActivityAwareTimeout<T>(
  promise: Promise<T>,
  options: {
    inactivityTimeoutMs: number;     // 无活动超时（默认 5 分钟）
    absoluteTimeoutMs: number;       // 绝对上限（默认 30 分钟）
    pollIntervalMs?: number;         // 轮询间隔（默认 30 秒）
    checkActivity: () => Promise<boolean>; // 活动检测函数
    onTimeout: () => Promise<void>;  // 超时回调
  },
): Promise<T> {
  const {
    inactivityTimeoutMs,
    absoluteTimeoutMs,
    pollIntervalMs = 30000,
    checkActivity,
    onTimeout,
  } = options;

  let lastActivityAt = Date.now();
  const startedAt = Date.now();
  let pollTimer: NodeJS.Timeout | null = null;
  let absoluteTimer: NodeJS.Timeout | null = null;
  let settled = false;

  const cleanup = () => {
    settled = true;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (absoluteTimer) { clearTimeout(absoluteTimer); absoluteTimer = null; }
  };

  return new Promise<T>((resolve, reject) => {
    // 绝对上限兜底
    absoluteTimer = setTimeout(() => {
      if (settled) return;
      cleanup();
      void onTimeout().catch(() => undefined);
      reject(new Error('STEP_TIMEOUT_EXCEEDED'));
    }, absoluteTimeoutMs);

    // 定期轮询活动状态
    pollTimer = setInterval(async () => {
      if (settled) return;
      try {
        const active = await checkActivity();
        if (active) {
          lastActivityAt = Date.now();
        }
      } catch {
        // 轮询失败不影响主流程
      }

      // 检查无活动超时
      if (Date.now() - lastActivityAt > inactivityTimeoutMs) {
        cleanup();
        void onTimeout().catch(() => undefined);
        reject(new Error('STEP_TIMEOUT_EXCEEDED'));
      }
    }, pollIntervalMs);

    // 原始 promise 完成
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}
```

#### 2.3.3 适配 worker 调用点

在 `processTask` 中，opencode 通道使用活动感知超时，native 通道保持固定超时：

```typescript
// opencode 通道：活动感知超时
if (isOpenCodeChannel && openCodeSessionId) {
  const executePromise = this.withActivityAwareTimeout(
    executeTaskPromise,
    {
      inactivityTimeoutMs: 300000,    // 5 分钟无活动则超时
      absoluteTimeoutMs: 1800000,     // 30 分钟绝对上限
      pollIntervalMs: 30000,          // 每 30 秒轮询一次
      checkActivity: async () => {
        const status = await this.adapter.getSessionStatus(openCodeSessionId, runtime);
        return status.active;
      },
      onTimeout: async () => {
        const latestRun = await this.taskService.getTaskById(taskId);
        if (latestRun?.runId) {
          await this.agentService.cancelRuntimeRun(latestRun.runId, 'step_timeout_cancel');
        }
      },
    },
  );
} else {
  // native 通道：保持固定超时
  const executePromise = this.withStepTimeout(executeTaskPromise, stepTimeoutMs, onTimeout);
}
```

#### 2.3.4 同步调大 axios 层超时

**文件**: `backend/apps/agents/src/modules/opencode/opencode.adapter.ts`

`promptSession` 的 axios 超时必须大于等于 worker 层的绝对上限。否则 axios 会先断开连接。

改动点：在 `resolveRequestTimeoutMs` 中，message 路由的默认超时从 120 秒改为与 step timeout 对齐（或设为 0 禁用 axios 层超时，完全由 AbortController 控制）：

```typescript
private resolveRequestTimeoutMs(route, runtime?, requestedTimeoutMs?) {
  if (requestedTimeoutMs !== undefined && requestedTimeoutMs !== null) {
    return this.normalizeTimeoutMs(requestedTimeoutMs, this.defaultRequestTimeoutMs);
  }
  if (runtime?.requestTimeoutMs !== undefined && runtime?.requestTimeoutMs !== null) {
    return this.normalizeTimeoutMs(runtime.requestTimeoutMs, this.defaultRequestTimeoutMs);
  }
  if (this.isMessageRoute(route)) {
    // message 路由超时由外层 AbortController 控制，
    // axios 层设为绝对上限兜底（30 分钟）
    return this.messageRequestTimeoutMs; // 环境变量 OPENCODE_MESSAGE_REQUEST_TIMEOUT_MS
  }
  return this.defaultRequestTimeoutMs;
}
```

**环境变量**：将 `OPENCODE_MESSAGE_REQUEST_TIMEOUT_MS` 默认值从 120000 改为 1800000（30 分钟），或改为 0（由 AbortController 控制）。

---

## 3. 实施步骤

### Step 1: 确认 opencode session 状态查询 API

在 opencode 服务端确认 `GET /session/{id}` 的返回格式。需要确认：
- 是否返回 messages 数组
- message 是否包含 `status` 字段（pending/running/completed）
- 是否有 `updatedAt` 等时间戳

如果 opencode API 不支持 session 状态查询，需要先在 opencode 侧实现，或使用 SSE 事件订阅作为替代。

### Step 2: 调大 axios 层超时（立即可做）

修改 `opencode.adapter.ts` 构造函数：

```typescript
this.messageRequestTimeoutMs = this.resolveTimeoutMs(
  'OPENCODE_MESSAGE_REQUEST_TIMEOUT_MS',
  1800000,  // 从默认 120s 改为 30 分钟
);
```

或在 `.env` 中设置 `OPENCODE_MESSAGE_REQUEST_TIMEOUT_MS=1800000`。

### Step 3: 实现 `getSessionStatus`

在 `opencode.adapter.ts` 中新增方法。

### Step 4: 实现 `withActivityAwareTimeout`

在 `agent-task.worker.ts` 中新增方法，替换 opencode 通道的调用。

### Step 5: 适配调用点

修改 `processTask` 方法中 `withStepTimeout` 的调用，分 opencode/native 两种模式。

需要注意 `openCodeSessionId` 的获取时机：当前通过 `onOpenCodeSession` 回调设置（worker.ts:210-227），这发生在 `executeWithRuntimeBridge` 中的 `ensureSessionId` 之后。因此活动检测在 session 创建前不可用，需要在 `checkActivity` 中处理 sessionId 尚未可用的情况。

### Step 6: 测试验证

1. 创建编排计划，包含 development 类型 task
2. 观察 opencode 执行超过 2 分钟的任务是否正常完成
3. 验证活动检测日志：`[activity_check] sessionId=xxx active=true`
4. 模拟 opencode 无响应（停止 opencode 服务），验证 5 分钟后超时触发

---

## 4. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| opencode 不支持 session 状态查询 | 无法实现方案 B | 备选：使用 SSE 事件流心跳检测，或退化为方案 C |
| 轮询增加 opencode 服务负载 | 每 30 秒一次 GET 请求 | 负载极低，可忽略 |
| 绝对上限设太长导致资源泄漏 | opencode session 僵死占用资源 | 30 分钟上限 + onTimeout 回调主动取消 |
| session 创建前无法检测活动 | 前几秒无活动检测 | session 创建通常 1-2 秒，inactivityTimeoutMs 设 5 分钟足以覆盖 |

---

## 5. 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `backend/apps/agents/src/modules/opencode/opencode.adapter.ts` | 新增方法 + 改默认值 | `getSessionStatus` + axios 超时调大 |
| `backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts` | 核心改造 | `withActivityAwareTimeout` + 调用点适配 |
| `backend/apps/agents/src/modules/opencode/opencode-execution.service.ts` | 可能适配 | 暴露 sessionId 给 worker 用于活动检测 |

---

## 6. 相关文档

| 文档 | 路径 | 关系 |
|------|------|------|
| OpenCode Worker 技术设计 | `docs/technical/OPENCODE_AGENT_TASK_SSE_WORKER_TECHNICAL_DESIGN.md` | OpenCode 执行层架构 |
| 引擎路由技术设计 | `docs/technical/AGENT_EXECUTOR_ENGINE_ROUTING_TECHNICAL_DESIGN.md` | 引擎层架构 |
| 编排开发工作流路由优化 Plan | `docs/plan/ORCHESTRATION_OPENCODE_ROUTING_FOR_DEV_WORKFLOW_PLAN.md` | 上游需求（路由修复） |

---

## 7. 临时兜底措施（已实施）

在根本性方案落地前，已做以下临时调整：

1. `agent-task.worker.ts:117` — opencode 通道 step timeout 从 120s 改为 900s
2. 但 **axios 层超时仍为 120s**，这意味着 `promptSession` 的 HTTP 请求在 2 分钟时仍会被 axios 断开

**下一步最低优先级操作**：在 `.env` 或代码中将 `OPENCODE_MESSAGE_REQUEST_TIMEOUT_MS` 设为 `1800000`（30 分钟），使 axios 层不再成为瓶颈。
