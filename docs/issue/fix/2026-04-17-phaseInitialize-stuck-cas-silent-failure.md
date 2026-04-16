# phaseInitialize 完成后 Plan 卡在 initialize 阶段 — CAS 静默失败

## 1. 基本信息

- 标题：phaseInitialize CAS 静默失败导致 Plan 永久卡住
- 日期：2026-04-17
- 负责人：opencode
- 关联 Requirement：
- 所属 Feature：[任务编排](../../feature/ORCHETRATION_TASK.md)
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：创建 Plan 后，phaseInitialize 完成了 outline 和 taskContext 的写入（metadata 中已有完整 outline），但 Plan 状态停留在 `status=draft`、`generationState.currentPhase=initialize`、`tasks=[]`，不会自动推进到 generating 阶段生成任务。
- 触发条件：Plan 创建后自动启动 `startGeneration()` → `advanceOnce()` → `phaseInitialize()`，在 `phaseInitialize` 的 LLM 调用期间或完成后，`updateGenerationStateIfExpected()` CAS 操作因 DB 状态不一致而返回 `false`。
- 影响范围：所有使用 `ORCH_STEP_DISPATCHER_ENABLED=true` 的增量编排 Plan（development / general / research 域均可能触发）。
- 严重程度：高（Plan 创建后完全无法自动推进，需人工介入）

## 3. 根因分析

### 直接原因

`orchestration-step-dispatcher.service.ts` 的 `phaseInitialize()` 方法在成功写入 outline 后，调用 `updateGenerationStateIfExpected()` 尝试将 phase 从 `initialize` 转为 `idle`。该方法是 MongoDB CAS（Compare-And-Swap）操作：

```typescript
// orchestration-step-dispatcher.service.ts:343-349
const advanced = await this.updateGenerationStateIfExpected(planId, state, {
  ...stateWithSession,
  currentPhase: 'idle',
  lastError: undefined,
});
if (!advanced) {
  return;  // ← 静默退出，无日志、无重试、无 autoAdvance
}
```

当 CAS 返回 `false` 时，方法直接 return，**不调用 `autoAdvance()`**，Plan 永久停留在 `currentPhase: "initialize"`。

### 深层原因

1. **CAS 失败后缺乏恢复机制**：`updateGenerationStateIfExpected` 的 filter 要求 DB 中 `generationState.currentPhase === expected.currentPhase`。如果在 `initializePlan()` LLM 调用期间（可能持续数十秒）DB 状态被并发修改（如 `stopGeneration()`、多实例竞争），CAS 必然失败。但代码未做任何日志记录或重试。

2. **initializePlan() 异常未捕获**：`plannerService.initializePlan()` 调用（第 273 行）没有 try/catch 包裹。如果 LLM 调用失败或超时抛异常，异常穿透到 `advanceOnce()`，被 `startGeneration()` 的 `.catch()` 吞掉，Plan 停留在 `initialize` phase。

3. **generateNext() 无法自愈已卡住的 initialize 状态**：`plan-management.service.ts` 的 `generateNext()` 方法中 `needsReset` 仅检查 `isComplete || consecutiveFailures > 0`。当 Plan 卡在 `initialize` 且无失败计数时，`needsReset=false`，不会重置 phase 到 `idle`，导致 `advanceOnce` 在 `phase === 'initialize'` 分支重新执行完整的 `phaseInitialize`（重复 LLM 调用），而非直接跳过已完成的初始化。

4. **phaseGenerate 等其他 phase 也存在同样的 CAS 静默失败模式**（第 518-520 行），但 `phaseGenerate` 的后续错误路径都有 `autoAdvance` 兜底，影响较小。

### 相关模块/文件

| 文件 | 位置 | 问题 |
|------|------|------|
| `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` | `phaseInitialize()` 第 343-349 行 | CAS 失败后静默退出，不调用 autoAdvance |
| 同上 | `phaseInitialize()` 第 315-337 行 | 失败路径同样存在 CAS 静默退出 |
| 同上 | `phaseInitialize()` 第 273 行 | `initializePlan()` 未 try/catch，异常穿透 |
| `backend/src/modules/orchestration/services/plan-management.service.ts` | `generateNext()` 第 410-412 行 | `needsReset` 不覆盖 `initialize` 卡住状态 |

## 4. 修复动作

### 修复方案

采用 **3 层防护**策略，从内到外逐层加固：

#### 4.1 核心修复：CAS 失败后调度 autoAdvance 恢复（Layer 1）

在 `phaseInitialize` 的两处 `updateGenerationStateIfExpected` 返回 `false` 的分支，添加日志 + `autoAdvance` 重试：

```typescript
// 成功路径 CAS 失败 (第 348-350 行)
if (!advanced) {
  this.logger.warn(
    `[phaseInitialize] CAS failed on success path for planId=${planId}, scheduling recovery autoAdvance`,
  );
  await this.autoAdvance(planId, source);
  return;
}

// 失败路径 CAS 失败 (第 335-337 行)
if (!advanced) {
  this.logger.warn(
    `[phaseInitialize] CAS failed on failure path for planId=${planId}, scheduling recovery autoAdvance`,
  );
  await this.autoAdvance(planId, source);
  return;
}
```

**原理**：CAS 失败意味着 DB 状态已被别人改动。调度 `autoAdvance` 让 dispatcher 重新从 DB 读取最新状态并决策下一步，而非静默放弃。`autoAdvance` 内部通过 `setImmediate` + `advanceOnce` 重新获取最新 plan 状态，可以正确处理各种并发场景。

#### 4.2 异常防护：initializePlan() try/catch（Layer 2）

为 `initializePlan()` 调用添加 try/catch，异常时增加失败计数并回退到 `idle`：

```typescript
try {
  await this.plannerService.initializePlan(planId, { ... }, { sessionId: plannerSessionId });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  this.logger.error(`[phaseInitialize] initializePlan failed for planId=${planId}: ${message}`);
  await this.agentClientService.archiveSession(plannerSessionId).catch(() => {});
  const nextState = this.bumpFailureCounters(state, `initializePlan failed: ${message}`);
  // 回退到 idle 并清除 session
  const recoveryState = this.isIsolatedSessionMode
    ? { ...nextState, currentPhase: 'idle' as const, plannerSessionIds: { ...(nextState.plannerSessionIds || {}), initialize: undefined } }
    : { ...nextState, currentPhase: 'idle' as const };
  await this.updateGenerationStateIfExpected(planId, state, recoveryState);
  await this.autoAdvance(planId, source);
  return;
}
```

#### 4.3 自愈入口：generateNext() 识别卡住的 initialize 状态（Layer 3）

扩展 `generateNext()` 的 `needsReset` 条件，让用户手动触发时也能恢复：

```typescript
const needsReset =
  currentState?.isComplete ||
  Number(currentState?.consecutiveFailures || 0) > 0 ||
  currentState?.currentPhase === 'initialize';  // ← 新增
```

当检测到 `currentPhase === 'initialize'` 时，重置 phase 到 `idle`，让 `advanceOnce` 重新评估是否需要 initialize（`shouldRunInitialize` 会检查 outline 是否已存在）。

### 代码改动点

| 文件 | 改动 | 说明 |
|------|------|------|
| `orchestration-step-dispatcher.service.ts` | `phaseInitialize()` 两处 CAS 失败分支添加日志 + autoAdvance | Layer 1 核心修复 |
| `orchestration-step-dispatcher.service.ts` | `phaseInitialize()` 为 `initializePlan()` 添加 try/catch | Layer 2 异常防护 |
| `plan-management.service.ts` | `generateNext()` needsReset 增加 `initialize` 判断 | Layer 3 自愈入口 |

### 兼容性处理

- 所有改动向后兼容，不影响已完成或正在正常运行的 Plan
- `autoAdvance` 内部有 `activePlannings` 防重入保护，不会导致并发问题
- `generateNext()` 的 reset 仅在手动调用时触发，不影响自动流程

## 5. 验证结果

- 验证步骤：
  1. 创建新的 development 类型 Plan，观察是否自动从 initialize 推进到 generating
  2. 在 phaseInitialize LLM 调用期间调用 `stopGeneration`，观察恢复行为
  3. 模拟 `initializePlan()` 异常（如断网），确认 Plan 不会永久卡住
  4. 对已卡住的 Plan 调用 `generateNext()`，确认能正确恢复
- 验证结论：TypeScript 编译通过（`tsc --noEmit` 主 tsconfig + agents tsconfig 均无错误）
- 测试与检查：typecheck 已通过

## 6. 风险与后续

- 已知风险：`autoAdvance` 重试在极端并发场景下可能导致短暂的重复 LLM 调用（但 `activePlannings` 防重入会阻止真正的并发执行）
- 后续优化：
  1. 考虑为所有 phase 方法的 CAS 失败分支统一添加恢复逻辑（phaseGenerate / phasePreExecute / phasePostExecute）
  2. 增加 Plan 健康检查定时任务，检测长时间卡在非 idle 状态的 Plan 并自动触发恢复
  3. 为 `updateGenerationStateIfExpected` 添加统一的 CAS 失败日志
- 是否需要补充功能文档/API文档：否
