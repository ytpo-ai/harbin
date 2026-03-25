# Agent Task 超时机制修复 Plan

> 创建时间：2026-03-25
> 状态：已完成（Step 1-6 全部实现，Step 7 SSE 独立排期）
> 完成时间：2026-03-25
> 影响范围：backend / agent-tasks / opencode

---

## 一、背景

`opencode` 模块与 `agent-tasks` 模块共同构成 Agent 任务的执行与超时体系。经深度分析，当前多层超时机制（HTTP 请求超时、步骤超时、活动感知超时、任务总超时）之间缺乏统一 deadline，导致以下已知风险：

- `taskTimeoutMs` 仅在执行前 pre-check，运行中不会持续生效
- OpenCode 通道绝对超时覆盖步骤超时语义
- 活动探测把异常/失联当成"活跃"
- 重试叠加超时可放大卡死时长
- abort 请求自身可能卡在默认 120s HTTP 超时

---

## 二、涉及文件

| 文件 | 职责 |
|---|---|
| `backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts` | 任务执行主循环、超时策略选择 |
| `backend/apps/agents/src/modules/agent-tasks/agent-task.service.ts` | 任务状态管理、默认超时写入 |
| `backend/apps/agents/src/modules/opencode/opencode.adapter.ts` | HTTP 请求超时、活动探测、SSE 流 |
| `backend/apps/agents/src/modules/opencode/opencode-execution.service.ts` | 执行桥接、AbortController、cancel 重试 |
| `backend/apps/agents/src/modules/opencode/contracts/opencode.contract.ts` | 类型定义 |
| `backend/apps/agents/src/schemas/agent-task.schema.ts` | 数据模型（stepTimeoutMs / taskTimeoutMs） |

---

## 三、问题清单（按优先级排序）

### P0-1：`taskTimeoutMs` 运行中无 watchdog

- **位置**：`agent-task.worker.ts:133`
- **现象**：仅在 `processTask` 开头做一次 `now - startedAtMs > taskTimeoutMs` 检查，进入 `executePromise` 后不再监控总时长
- **影响**：如果步骤超时 > 任务超时，任务超时形同虚设；重试场景下 `maxAttempts * stepTimeout` 可能远超 `taskTimeoutMs`

### P0-2：OpenCode 绝对超时与 stepTimeoutMs 语义不一致

- **位置**：`agent-task.worker.ts:258`
- **现象**：`absoluteTimeoutMs = Math.max(stepTimeoutMs, opencodeAbsoluteTimeoutMs)` 取 max，而 schema 创建时 stepTimeoutMs=120000（2分钟），opencodeAbsoluteTimeoutMs 默认 1800000（30分钟）。实际绝对超时固定 30 分钟
- **补充**：`agent-task.worker.ts:131` 的 `defaultStepTimeoutMs = isOpenCodeChannel ? 900000 : 120000` 由于 `createTask` 已写入 `stepTimeoutMs=120000`，`||` 判断不会 fallback 到 900000，该防御代码**永远不生效**

### P1-1：活动探测异常容忍过于乐观（双重假活跃）

- **位置 A**：`opencode.adapter.ts:108` — catch 返回 `{ active: true }`
- **位置 B**：`agent-task.worker.ts:528-529` — checkActivity 抛错刷新 `lastActivityAt`
- **影响**：网络故障或 OpenCode 服务不可达时，inactivity 计时器无法推进，只能等绝对超时

### P1-2：abort 请求自身超时过长

- **位置**：`opencode-execution.service.ts:509-533`
- **现象**：abort 重试最多 3 次，每次使用默认 `defaultRequestTimeoutMs=120s`。最坏 `3 * 120s = 360s` 才返回
- **影响**：取消操作需要 6 分钟才能完成，步骤超时已触发后仍在等 abort

### P1-3：重试叠加放大超时

- **位置**：`agent-task.worker.ts:349` + `agent-task.worker.ts:439-446`
- **现象**：`STEP_TIMEOUT_EXCEEDED` 包含 'timeout'，被 `isRetryableError` 判为可重试。每次重试再等 30 分钟绝对超时
- **影响**：`maxAttempts=3` 时，总时长可能达 90 分钟，远超 `taskTimeoutMs=20min`

### P2-1：session 未就绪阶段默认 active=true

- **位置**：`agent-task.worker.ts:261`
- **现象**：`openCodeSessionId` 未绑定前 `checkActivity` 直接返回 true
- **影响**：实际发生概率较低（session 创建失败会直接抛异常），但极端场景仍可能前置挂死

### P2-2：超时相关测试完全缺失

- **位置**：`opencode/*.spec.ts` + `agent-tasks/*.spec.ts`
- **现象**：无任何 spec 覆盖 `withStepTimeout`、`withActivityAwareTimeout`、taskTimeout watchdog
- **影响**：后续改动回归风险高

### P2-3：SSE 连接无总时长限制

- **位置**：`runtime-sse-stream.service.ts`
- **现象**：SSE Observable 只发 heartbeat 无终止条件。任务完成后若 worker 异常退出未发 result，连接一直活着
- **影响**：客户端资源泄漏

---

## 四、修复步骤

### Step 1：引入任务级 watchdog（修复 P0-1 + P1-3）

- **改动文件**：`agent-task.worker.ts`
- **方案**：
  1. 在 `processTask` 中计算 `taskDeadlineAt = startedAtMs + taskTimeoutMs`
  2. 将 `executePromise` 再包一层 `withAbsoluteDeadline(promise, taskDeadlineAt - Date.now())`
  3. 该 watchdog 包裹在最外层，无论 Native/OpenCode 通道、无论重试，都受约束
  4. 错误码保持 `TASK_TIMEOUT_EXCEEDED`，payload 附加 `elapsedMs`、`taskTimeoutMs`
- **关键影响**：backend / agent-tasks / 无前端变动 / 无 DB 变动

### Step 2：修正 OpenCode 绝对超时与 step timeout 关系（修复 P0-2）

- **改动文件**：`agent-task.worker.ts`
- **方案**：
  1. 将 `Math.max(stepTimeoutMs, opencodeAbsoluteTimeoutMs)` 改为 `Math.min(taskRemainingMs, opencodeAbsoluteTimeoutMs)`
  2. 引入 `taskRemainingMs = taskDeadlineAt - Date.now()`，确保绝对超时不超过任务剩余预算
  3. 清理 `defaultStepTimeoutMs = isOpenCodeChannel ? 900000 : 120000` 这段永不生效的防御代码，或改为在 `createTask` 时按 channel hint 写入不同 stepTimeoutMs
- **关键影响**：backend / agent-tasks

### Step 3：修复活动探测假活跃（修复 P1-1）

- **改动文件**：`opencode.adapter.ts`、`agent-task.worker.ts`
- **方案**：
  1. `getSessionStatus` catch 改为返回 `{ active: false }`（或新增 `unknown` 状态）
  2. `withActivityAwareTimeout` catch 分支**不刷新** `lastActivityAt`
  3. 可选增强：引入连续失败计数器，连续 N 次 unknown 后触发 inactivity 超时
- **关键影响**：backend / opencode / agent-tasks

### Step 4：缩短 abort 请求 HTTP 超时（修复 P1-2）

- **改动文件**：`opencode-execution.service.ts`
- **方案**：
  1. `cancelSession` 中对 `adapter.abortSession` 调用时传入 `requestTimeoutMs: 10000`（10 秒）
  2. 或在 adapter 中为 `/abort` 路由配置独立短超时
- **关键影响**：backend / opencode

### Step 5：增加 session 未就绪窗口超时（修复 P2-1）

- **改动文件**：`agent-task.worker.ts`
- **方案**：
  1. 引入 `sessionInitTimeoutMs`（默认 60 秒，可通过环境变量配置）
  2. 在 `checkActivity` 中：如果 `openCodeSessionId` 为空且距离任务开始已超过 `sessionInitTimeoutMs`，返回 false
- **关键影响**：backend / agent-tasks

### Step 6：补齐超时测试（修复 P2-2）

- **改动文件**：新增 `agent-task.worker.spec.ts` 或 `timeout.behavior.spec.ts`
- **覆盖场景**：
  1. `withStepTimeout`：promise 超时触发 STEP_TIMEOUT_EXCEEDED
  2. `withActivityAwareTimeout`：inactivity 超时、absolute 超时、checkActivity 异常场景
  3. 任务级 watchdog：taskTimeoutMs < stepTimeoutMs 时优先触发 TASK_TIMEOUT_EXCEEDED
  4. abort 超时短路：cancelSession 在 10s 内返回
  5. 重试不超过 taskTimeoutMs 总预算

### Step 7（可选）：SSE 连接增加总时长上限（修复 P2-3）

- **改动文件**：`runtime-sse-stream.service.ts`
- **方案**：在 Observable 中增加 `maxConnectionMs` 超时后自动 complete
- **优先级**：低，可后续单独处理

---

## 五、预期行为矩阵（验收标准）

| 场景 | 预期行为 |
|---|---|
| `taskTimeoutMs=20min` < `stepTimeoutMs=30min` | 任务在 ~20min 触发 `TASK_TIMEOUT_EXCEEDED`，不等 step |
| OpenCode 通道 + `stepTimeoutMs=2min` | 绝对超时受 `taskRemainingMs` 约束，不固定拖到 30 分钟 |
| `/session/{id}` 连续探测失败 5 次 | inactivity 计时器正常推进，不被异常续命 |
| abort 请求目标不可达 | cancelSession 在 ~30s 内返回（3次 * 10s），不等 6 分钟 |
| 用户取消与超时并发 | 最终状态收敛为 `cancelled`（用户取消优先） |
| 重试 3 次，每次步骤超时 | 总时长不超过 `taskTimeoutMs` |
| session 创建卡住 60s | checkActivity 返回 false，触发 inactivity 超时 |

---

## 六、风险与依赖

| 风险 | 缓解措施 |
|---|---|
| 正常 OpenCode 长任务（15-30min）被误杀 | 确保 `taskTimeoutMs` 默认值足够大（默认 20min），OpenCode 场景建议任务级配置 45-60min |
| Step 3 改 `active: false` 后正常网络抖动误判 | 引入连续失败计数器（≥3 次再判不活跃） |
| Step 2 改 `Math.min` 后现有 OpenCode 任务时间不够 | 上线前检查线上 OpenCode 任务实际执行时长分布，调整默认值 |
| 测试 mock 与实际 OpenCode server 行为差异 | 补充 E2E 测试用 mock server |

---

## 七、执行顺序

```
Step 1 (P0-1 watchdog)
  └─> Step 2 (P0-2 绝对超时修正，依赖 Step 1 的 taskRemainingMs)
        └─> Step 3 (P1-1 假活跃修复)
              └─> Step 4 (P1-2 abort 短超时)
Step 5 (P2-1 session init timeout，可并行)
Step 6 (P2-2 测试，每个 Step 完成后同步补)
Step 7 (P2-3 SSE 上限，独立排期)
```

Step 1-4 为核心修复链，建议单 PR 合入或按 Step 拆分 commit。
Step 5-7 可独立排期。

---

## 八、实施记录

### 已完成（2026-03-25）

| Step | 修改文件 | 核心改动 |
|---|---|---|
| Step 1 | `agent-task.worker.ts` | 引入 `taskDeadlineAt` + `withAbsoluteDeadline` 方法包裹 `executePromise`，确保任务总时长受 `taskTimeoutMs` 约束 |
| Step 2 | `agent-task.worker.ts` | `Math.max(stepTimeoutMs, opencodeAbsoluteTimeoutMs)` → `Math.min(taskRemainingMs, opencodeAbsoluteTimeoutMs)`；清理永不生效的 `isOpenCodeChannel ? 900000` 防御代码 |
| Step 3 | `opencode.adapter.ts` + `agent-task.worker.ts` | adapter `getSessionStatus` catch 改为 `{ active: false }`；worker `withActivityAwareTimeout` catch 分支不再刷新 `lastActivityAt` |
| Step 4 | `opencode.adapter.ts` + `opencode-execution.service.ts` | `abortSession` 新增可选 `timeoutMs` 参数；`cancelSession` 传入 `timeoutMs: 10000`，最坏 3×10s=30s |
| Step 5 | `agent-task.worker.ts` | 新增 `sessionInitTimeoutMs`（默认 60s，环境变量 `AGENT_TASK_SESSION_INIT_TIMEOUT_MS`）；`checkActivity` 中 session 未就绪超时返回 false |
| Step 6 | 新增 `agent-task-timeout.spec.ts` | 23 个测试覆盖 withStepTimeout / withActivityAwareTimeout / withAbsoluteDeadline / isRetryableError / getSessionStatus 异常 / cancelSession 短超时 |

### 额外修复

- `isRetryableError` 新增 `STEP_TIMEOUT_EXCEEDED` 和 `TASK_TIMEOUT_EXCEEDED` 排除规则，避免超时类错误触发重试导致时长放大
- 非 OpenCode 通道的 `withStepTimeout` 也受 `taskRemainingMs` 约束：`Math.min(stepTimeoutMs, taskRemainingMs)`

### 新增环境变量

| 变量名 | 默认值 | 说明 |
|---|---|---|
| `AGENT_TASK_SESSION_INIT_TIMEOUT_MS` | 60000 (60s) | session 未就绪窗口超时，超过后 checkActivity 返回 false |
