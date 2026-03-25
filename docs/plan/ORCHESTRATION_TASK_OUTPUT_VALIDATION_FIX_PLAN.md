# [已弃用] ORCHESTRATION_TASK_OUTPUT_VALIDATION_FIX_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration 任务输出校验与 Agent 执行质量守护修复方案

## 背景

在 [Test-2] Agency-Agents Prompt 全量导入计划执行中，执行 Agent（小武 / CEO助理, agent:699f40ad709a628508681e4d）因缺少所需工具（repo-writer、save-prompt-template、web-search、web-fetch），多次返回"我无法执行"类回复，但系统层面未能有效拦截这些无效输出。

### 现象

1. **`general`/`development` 类型任务的"虚假完成"**：Task 0（general）和 Task 1（development）的产出内容均为"我无法按你的验收标准实际完成这三步"，但被系统标记为 `completed`，后续 Planner 据此做出错误判断。

2. **Research 任务校验有效但分配无效**：Task 2/11/12 被分类为 research 后，`validateResearchOutput()` 正确拦截了缺少 `RESEARCH_EXECUTION_PROOF` 的输出并标记 `failed`。然而 Planner 随后创建了新任务而非修正原任务的分配。

3. **Agent 在无工具情况下的回复策略不当**：小武在缺少工具时回复了大段"替代方案建议"（如脚本示例、操作指令），这些内容绕过了 inability 信号检测（`validateResearchOutput` 的 inability signals 仅覆盖了 6 个关键词，且只对 research 类型生效）。

### 根因分析

当前输出校验覆盖矩阵（`orchestration-execution-engine.service.ts:278-374`）：

| taskType | 校验方法 | 失败后果 |
|---|---|---|
| research | `validateResearchOutput()` | **硬失败** |
| review | `validateReviewOutput()` | **硬失败** |
| external_action | `extractEmailSendProof()` | waiting_human |
| development | `validateCodeExecutionProof()` | **仅 warning，不阻断** |
| general | 无 | **直接标记 completed** |

`general` 和 `development` 类型完全缺乏"inability 信号"检测——当 agent 明确表示"我无法执行"时，系统仍将其标记为成功。

## 核心目标

1. 为所有 taskType 增加通用的 inability 信号检测，防止"我无法执行"被标记为 completed
2. 为 `development` 类型任务的校验从 warning 升级为可配置的硬失败
3. 保持已有的 research / review / external_action 校验逻辑不变

## 影响范围

| 层级 | 影响 |
|------|------|
| **Task Output Validation Service** | `task-output-validation.service.ts` — 新增通用 inability 检测方法 |
| **Execution Engine** | `orchestration-execution-engine.service.ts` — 在成功路径前增加通用校验 |
| **Schema** | 无变更 |
| **前端** | 无影响 |

## 执行步骤

### Step 1: 新增通用 Inability 信号检测方法

**关键影响点**: 后端 — `task-output-validation.service.ts`

新增 `validateGeneralOutput()` 方法，适用于所有 taskType：

```typescript
validateGeneralOutput(output: string): { valid: boolean; reason?: string; missing?: string[] } {
  const text = (output || '').trim();
  if (!text) {
    return { valid: false, reason: 'empty output', missing: ['content'] };
  }

  const lower = text.toLowerCase();
  const inabilitySignals = [
    // 中文
    '无法执行', '无法完成', '无法按', '我没有', '缺少工具',
    '没有可用的', '无法直接', '不具备', '无法访问', '无法浏览',
    // 英文
    'cannot execute', 'unable to complete', 'i don\'t have',
    'missing tool', 'cannot browse', 'unable to access',
    'don\'t have direct access', 'i cannot perform',
    'lack the ability', 'not equipped',
  ];

  if (inabilitySignals.some((signal) => lower.includes(signal))) {
    return {
      valid: false,
      reason: 'agent reported inability to execute task',
      missing: ['executable-result'],
    };
  }

  return { valid: true };
}
```

### Step 2: 在执行引擎成功路径前注入通用校验

**关键影响点**: 后端 — `orchestration-execution-engine.service.ts`

在现有的 research/review/external_action 校验**之前**，增加通用 inability 检测：

```typescript
// 通用 inability 检测（所有 taskType 适用）
const generalValidation = this.taskOutputValidationService.validateGeneralOutput(output);
if (!generalValidation.valid) {
  await this.markTaskFailed(taskId, `General output validation failed: ${generalValidation.reason}`);
  // ... emit events
  return { status: 'failed', error: generalValidation.reason };
}
```

这确保即使 taskType 为 `general` 或 `development`，当 agent 明确报告"我无法执行"时，任务不会被标记为 completed。

### Step 3: `development` 类型校验升级为可选硬失败

**关键影响点**: 后端 — `orchestration-execution-engine.service.ts`

当前 `validateCodeExecutionProof()` 仅产出 warning（`runLogs` 中记录但不阻断）。改为可配置模式：

- 新增环境变量 `CODE_VALIDATION_MODE`，取值 `warn`（默认，保持现有行为）或 `strict`（硬失败）
- 在 `strict` 模式下，如果 `validateCodeExecutionProof()` 返回 `valid: false`，将任务标记为 failed

### Step 4: 扩展 Research 校验的 inability 信号词库

**关键影响点**: 后端 — `task-output-validation.service.ts`

当前 `validateResearchOutput()` 的 inability signals 仅有 6 个关键词（line 108-115）。扩展为与 Step 1 中通用检测保持同步的词库，确保覆盖更多场景：

- 追加："我这边无法""当前会话没有""没有接入""缺少.*工具"等模式
- 使用正则而非纯字符串匹配，提高灵活性

### Step 5: Agent 侧——增加 Task Output Contract 提示

**关键影响点**: 后端 — `orchestration-context.service.ts`

在为 agent 构建任务描述时（`buildTaskDescription`），追加一段通用输出规范提示：

```
【输出规范】
- 如果你缺少完成此任务所需的工具或权限，必须在输出开头明确声明：TASK_INABILITY: <原因>
- 禁止在无法执行时输出替代方案建议或操作指令作为任务产出
- 只有实际完成了任务要求的动作，才应输出执行结果
```

这让 agent 的"无法执行"回复格式化，便于系统检测；同时避免 agent 用大段建议文本掩盖实质失败。

## 风险与应对

| 风险 | 应对措施 |
|------|---------|
| Inability 信号误命中合法输出（如讨论第三方能力时用到"无法"等词） | 通用检测只检查前 500 字符，降低误命中概率；后续可升级为语义检测 |
| 过于严格导致可接受的部分完成也被拒绝 | 通用检测仅检查"agent 自述无法执行"的硬信号，不检查产出质量 |
| `CODE_VALIDATION_MODE=strict` 在 CI/CD 场景下误杀 | 默认保持 `warn`，仅在需要时手动启用 strict |
| Agent 不遵循 TASK_INABILITY 格式约束 | 通用 inability 检测作为兜底，不依赖 agent 遵从格式 |

## 依赖关系

- 关联方案：`ORCHESTRATION_PLANNER_AGENT_SELECTION_FIX_PLAN.md`（Planner 侧修复）
- 关联方案：`ORCHESTRATION_INCREMENTAL_PLANNING_FAILOVER_FIX_PLAN.md`（系统层面失败重试机制改进）
- 前置完成：无（可独立实施）
