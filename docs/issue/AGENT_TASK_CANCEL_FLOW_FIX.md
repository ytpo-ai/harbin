# Agent Task 取消流程修复记录

> 日期：2026-03-16
> 状态：已修复并验证

## 1. 问题描述

用户在前端点击「取消任务」后，后端 Agent Task 未能及时中止，表现为：

- 任务在取消后仍持续运行 30~45 秒，直到 OpenCode 自然完成才返回
- 即使 `cancelRequested=true`，任务最终状态仍为 `succeeded`（而非 `cancelled`）
- 取消操作无实际效果，用户体验上等同于没有取消功能

## 2. 根因分析

经排查，定位到 **4 个关键问题**，它们共同导致了取消链路失效：

### 根因 1：`onStarted` 生命周期回调从未在流式执行中调用

**位置**：`backend/apps/agents/src/modules/agents/agent.service.ts` — `executeTaskWithStreaming` 方法

**现象**：Worker 在 `onStarted` 回调中保存 `runId` 和 `sessionId` 到任务记录，但 `executeTaskWithStreaming`（流式执行路径）从未调用 `onStarted`。只有非流式的 `executeTask` 方法（line ~804）才会调用。

**影响**：任务数据库中的 `runId` 始终为空，导致取消监听器 `cancelRuntimeRun` 无法拿到有效的 `runId` 来中止运行。在测试中观察到 `runId` 全程显示为 `none`，直到任务完成才被写入。

### 根因 2：`promptSession` 是阻塞式同步 HTTP 请求，无法被中断

**位置**：`backend/apps/agents/src/modules/opencode/opencode.adapter.ts` — `promptSession` 方法

**现象**：`adapter.promptSession()` 使用 axios 发起同步 HTTP 请求并阻塞等待 OpenCode 返回完整响应。即使后端已成功调用了 `/session/:id/abort`，正在进行中的 axios 请求完全不知道也不会被打断，仍然继续等待直到超时或 OpenCode 返回。

**影响**：取消请求虽然成功发到了 OpenCode 服务端（返回 `true`），但 `executeWithRuntimeBridge` 方法仍在等待 `promptSession` 返回，无法提前退出。

### 根因 3：`cancelSession` 未中断正在进行的 HTTP 请求

**位置**：`backend/apps/agents/src/modules/opencode/opencode-execution.service.ts` — `cancelSession` 方法

**现象**：`cancelSession` 只调用了 `adapter.abortSession()` 来通知 OpenCode 服务端中止会话，但没有任何机制来中断正在 `executeWithRuntimeBridge` 中等待的那个 `promptSession` HTTP 请求。

**影响**：即使 OpenCode 服务端接受了 abort 请求，后端仍在等待已经发出的 HTTP 请求返回，造成取消后仍需等待 30~45 秒。

### 根因 4：状态判定逻辑错误

**位置**：`backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts` — line 229

**原代码**：
```typescript
const status = latestTask?.cancelRequested && !hasResponse ? 'cancelled' : 'succeeded';
```

**问题**：如果 OpenCode 在 abort 生效前已经返回了任何响应内容（`hasResponse=true`），即使 `cancelRequested=true`，任务也会被标记为 `succeeded`。

**影响**：在测试中，一个长任务被取消后，由于 OpenCode 在 abort 前已产出了 332 字符的部分响应，任务最终仍被标记为 `succeeded`。

## 3. 修复方案

### Fix 1：在 `executeTaskWithStreaming` 中添加 `onStarted` 回调

**文件**：`agent.service.ts`

在 `startRuntimeExecution` 之后、`appendSystemMessagesToSession` 之前，调用 `onStarted` 回调将 `runId`/`sessionId`/`traceId` 提前写入任务记录。

```typescript
// executeTaskWithStreaming 方法中，runtimeExecution 创建后立即回调
await options.onStarted?.({
  runId: runtimeExecution.runId,
  sessionId: runtimeExecution.sessionId,
  traceId: runtimeExecution.traceId,
});
```

### Fix 2：为 `promptSession` 添加 `AbortSignal` 支持

**文件**：`opencode.adapter.ts`、`opencode-execution.service.ts`

1. `adapter.promptSession()` 新增可选 `signal?: AbortSignal` 参数
2. `adapter` 内部 `request()` 方法将 `signal` 透传给 `axios.request()`
3. `executeWithRuntimeBridge` 创建 `AbortController`，注册到 `activeAbortControllers` Map（以 `sessionId` 为 key），将 `signal` 传递给 `promptSession`
4. 在 `catch` 中通过 `isAbortError()` 识别中断错误，返回空响应而非抛异常

```typescript
// opencode-execution.service.ts
private readonly activeAbortControllers = new Map<string, AbortController>();

// executeWithRuntimeBridge 中
const abortController = new AbortController();
this.activeAbortControllers.set(sessionId, abortController);
try {
  prompt = await this.adapter.promptSession(
    { sessionId, prompt, model, runtime },
    { signal: abortController.signal },
  );
} catch (error) {
  if (this.isAbortError(error)) {
    return { sessionId, response: '', metadata: {} };
  }
  throw error;
} finally {
  this.activeAbortControllers.delete(sessionId);
}
```

### Fix 3：`cancelSession` 同时中断 HTTP 请求

**文件**：`opencode-execution.service.ts`

`cancelSession` 方法新增两步操作：
1. 从 `activeAbortControllers` Map 中查找对应的 `AbortController` 并调用 `.abort()`，立即中断正在等待的 HTTP 请求
2. 继续调用 `adapter.abortSession()` 通知 OpenCode 服务端

```typescript
async cancelSession(sessionId: string, runtime?: OpenCodeRuntimeOptions): Promise<boolean> {
  // 1. 中断正在进行的 HTTP 请求
  const controller = this.activeAbortControllers.get(normalizedSessionId);
  if (controller) {
    controller.abort();
    this.activeAbortControllers.delete(normalizedSessionId);
  }
  // 2. 通知 OpenCode 服务端
  await this.adapter.abortSession(normalizedSessionId, runtime);
}
```

新增 `isAbortError()` 辅助方法，识别以下中断错误类型：
- `DOMException` with `name === 'AbortError'`
- Error message 包含 `abort` 或 `cancel`
- Axios 错误码 `ERR_CANCELED` 或 `ECONNABORTED`

### Fix 4：修正状态判定逻辑

**文件**：`agent-task.worker.ts`

```typescript
// 修复前（错误）
const status = latestTask?.cancelRequested && !hasResponse ? 'cancelled' : 'succeeded';

// 修复后（正确）
const status = latestTask?.cancelRequested ? 'cancelled' : 'succeeded';
```

只要 `cancelRequested=true`，无论是否有响应内容，任务状态一律为 `cancelled`。同时移除了不再使用的 `hasResponse` 变量。

## 4. 验证结果

修复后创建测试任务 `task-43ecac82-5250-4fb3-ac1d-56e96cd9417b`：

| 阶段 | 时间 | 状态 |
|------|------|------|
| 任务创建 | 12:50:14 | `queued` |
| 任务开始运行 | 12:50:22 | `running`，`runId=run-f497543c-...` |
| 发送取消 | 12:50:24 | `cancelRequested=true` |
| 任务终止 | 12:50:33 | `cancelled` |

关键日志确认：
```
[opencode_prompt] registered AbortController sessionId=ses_30b04e39...
[opencode_cancel] aborting in-flight HTTP request sessionId=ses_30b04e39...
[opencode_request_failed] code=ERR_CANCELED error=canceled        ← axios 请求被中断
[opencode_prompt] aborted sessionId=ses_30b04e39...               ← 中断错误被捕获
OpenCode abort request success sessionId=ses_30b04e39...          ← 服务端也收到 abort
```

**修复前 vs 修复后对比**：

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 取消后等待时间 | 30~45 秒 | ~9 秒 |
| `runId` 可用时间 | 任务完成后 | 任务启动后立即可用 |
| 取消后最终状态 | `succeeded`（有响应时） | `cancelled` |
| HTTP 请求中断 | 不中断 | 立即中断 |

## 5. 已知遗留问题

### 5.1 ~~取消响应时间仍有 ~9 秒延迟~~ (已修复)

> **修复日期**：2026-03-16
>
> **修复方案**：在 `AgentTaskService` 中新增 `EventEmitter cancelEmitter`，`cancelTask` 保存 `cancelRequested=true` 后立即 emit `cancel:{taskId}` 事件。`AgentTaskWorker.waitForTaskCancellation` 重写为 EventEmitter 事件驱动 + 轮询双保险模式：worker 同时监听事件（毫秒级响应）和轮询（fallback），取消延迟从 ~9 秒降至毫秒级。

### 5.2 EI Sync 失败（非本次修复范围）

日志中持续出现 `RuntimeEiSyncService` 404 错误。这是 EI（研发智能）同步模块的独立问题，与取消流程无关，不影响任务执行和取消功能。

### 5.3 ~~idempotencyKey 唯一索引冲突~~ (无需修复)

> **确认日期**：2026-03-16
>
> 实际代码中索引已定义为 `{ idempotencyKey: 1, userId: 1 }` 且带 `sparse: true`，MongoDB sparse 唯一索引会跳过 `null`/`undefined` 的文档，不会触发 E11000 冲突。此问题无需额外修复。

## 6. 涉及文件

| 文件 | 修改内容 |
|------|----------|
| **第一轮修复（根因修复）** | |
| `backend/apps/agents/src/modules/agents/agent.service.ts` | 在 `executeTaskWithStreaming` 中添加 `onStarted` 回调调用 |
| `backend/apps/agents/src/modules/opencode/opencode.adapter.ts` | `promptSession` 和 `request` 方法新增 `signal` 参数 |
| `backend/apps/agents/src/modules/opencode/opencode-execution.service.ts` | 新增 `activeAbortControllers` Map、修改 `cancelSession` 中断 HTTP 请求、新增 `isAbortError()` |
| `backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts` | 修正状态判定逻辑，移除 `hasResponse` 条件 |
| **第二轮修复（遗留问题）** | |
| `backend/apps/agents/src/modules/agent-tasks/agent-task.service.ts` | 新增 `EventEmitter cancelEmitter`，`cancelTask` emit 取消事件；SSE status 改为 `'cancelling'` |
| `backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts` | `waitForTaskCancellation` 重写为 EventEmitter + 轮询双模式；`cancelRuntimeRun` 调用传入正确 reason |
| `backend/apps/agents/src/modules/agents/agent.service.ts` | `cancelRuntimeRun` 新增可选 `reason` 参数（默认 `'user_cancel'`） |
| `backend/apps/agents/src/modules/opencode/opencode-execution.service.ts` | `cancelSession` 新增 3 次重试逻辑 |
| `backend/apps/agents/src/modules/opencode/opencode.adapter.ts` | `request` catch 块修正：`throwOnError=false` 时返回 `undefined` 而非抛出 |


Frontend (AgentTaskRunner.tsx)
    |
    |  POST /agents/tasks/:taskId/cancel  { reason }
    v
AgentTaskController.cancelTask()
    |
    v
AgentTaskService.cancelTask()
    |-- Sets task.cancelRequested = true  (MongoDB)
    |-- Emits cancelEmitter 'cancel:{taskId}' event  ← 毫秒级通知 Worker
    |-- If task.runId exists:
    |      RuntimeOrchestrator.cancelRunWithActor()  -> sets run.status = 'cancelled'
    |-- Publishes SSE 'status' event with status: 'cancelling', cancelRequested: true
    |
    v
AgentTaskWorker (background, EventEmitter + polling fallback)
    |
    |-- waitForTaskCancellation() 双模式监听:
    |      1. EventEmitter: 监听 cancelEmitter 'cancel:{taskId}' 事件（毫秒级响应）
    |      2. Polling fallback: 每 500ms 查询 task.cancelRequested（兜底）
    |      When detected:
    |      |-- Calls agentService.cancelOpenCodeSession(sessionId, {endpoint, authEnable})
    |      |      -> OpenCodeExecutionService.cancelSession()
    |      |          -> Retries abortSession() up to 3 times (1s, 2s intervals)
    |      |          -> OpenCodeAdapter.abortSession()
    |      |              -> POST /session/:sessionId/abort  (to OpenCode server)
    |      |-- Calls agentService.cancelRuntimeRun(runId, reason)
    |      |      -> RuntimeOrchestrator.cancelRunWithActor()
    |      |      reason: 'user_cancel' (用户取消) | 'step_timeout_cancel' (超时取消)
    |
    |-- Also checks cancelRequested in onStarted/onOpenCodeSession lifecycle callbacks
    |      for immediate abort if cancel was requested before session was established


Issues Identified (from首次排查)

> 以下是首次修复后遗留的小问题清单。在 2026-03-16 的第二轮修复中，大部分已被解决。

1. ~~Misleading cancel reason in cancelRuntimeRun (minor)~~ — **已修复**
   File: `agent.service.ts`
   `cancelRuntimeRun()` 新增可选 `reason` 参数（默认 `'user_cancel'`）。Worker 在用户取消场景传 `'user_cancel'`，超时取消场景传 `'step_timeout_cancel'`。

2. ~~No retry on failed OpenCode abort (medium)~~ — **已修复**
   File: `opencode-execution.service.ts`
   `cancelSession()` 新增重试逻辑：`abortSession()` 最多重试 3 次（间隔 1s、2s），全部失败后仅 warn 日志，不再静默丢失。

3. Race condition window between cancel and session creation (low risk, mitigated) — **无需修复**
   已有 `onOpenCodeSession` 生命周期回调在 session 建立时检查 `cancelRequested`，可覆盖此窗口。风险极低，保持现状。

4. ~~Status event payload shows current status, not 'cancelled' (cosmetic)~~ — **已修复**
   File: `agent-task.service.ts`
   SSE 事件 payload 中 `status` 从 `task.status`（`'running'`）改为固定值 `'cancelling'`，更清晰地告知前端任务正在取消中。

5. Double cancel of runtime run — **无需修复**
   `cancelRunWithActor` 是幂等操作（已取消的 run 会静默返回），双重取消不会产生副作用。保持现状。

6. ~~abortSession does not set throwOnError: true but still throws~~ — **已修复**
   File: `opencode.adapter.ts`
   `request()` 的 catch 块已修正：当 `throwOnError` 不为 `true` 时返回 `undefined` 而非重新抛出异常。`throwOnError` 参数现在按预期生效。