# 计划编排 Planner planId 幻觉 + JSON 解析失败 + 多任务批量提交 修复记录

> 日期：2026-03-29  
> 关联计划：`69c8207dca3c23e14b1efce3`、`69c82978f5ef6bf62f341eed`、`69c82ec518a7df76eb1cffd1`、`69c8325712cff082b097ff8c`  
> 状态：**已修复并验证通过**

---

## 一、问题现象

### 计划 1（69c8207d）：30 step 限制跑满后失败

- 前端页面 `http://localhost:3000/orchestration/plans/69c8207dca3c23e14b1efce3` 显示计划失败
- `generationState.totalGenerated = 0`，`totalFailures = 6`
- 6 个 agent runs 全部 `sync.state = failed`，`sync.lastError = "Request failed with status code 400"`
- 最后一个 run（run-9de49bb3）包含 33 条 messages，跑满了 `DEFAULT_MAX_TOOL_ROUNDS = 30` 后触发 `工具调用轮次已达上限`

### 计划 2（69c82978）：Planner 返回空字符串

- 日志显示 `[planner_raw_response] responseLen=0 preview=""`
- 3 次 `generateNextTask` 全部返回空字符串 → `planner_parse_fail`
- `consecutiveFailures = 3 >= maxRetries = 3` → 计划终止

---

## 二、问题追溯过程

### 阶段 1：分析计划 69c8207d 的 6 个 Runs

**疑问**：为什么 6 个 runs 全部 sync 400？

**排查步骤**：
1. 查询 `orchestration_plans` 获取 `generationState` → `totalGenerated=0, totalFailures=6`
2. 查询 `agent_runs`（通过 sessionId 正则匹配 planId）→ 找到 6 个 runs
3. 查询 `agent_sessions` → 找到 session，71 条 messages
4. 逐条查看 messages 的 role、content、parts

**发现**：
- Run 1：Agent 使用全限定工具名 `builtin.sys-mg.mcp.orchestration.submit-task` 调用，但后端返回 **500 Internal Server Error**
- Run 2~5：Session 消息累积导致上下文污染，Agent 开始使用缩写工具名（`submit-task`）→ 工具不匹配
- Run 6：Agent 在污染上下文中连续猜测不存在的工具名（`output-validation`, `none`, `__unavailable__` 等），跑满 30 轮

### 阶段 2：追查 Run 1 的 submit-task 500 错误

**疑问**：submit-task 工具后端为什么返回 500？

**排查步骤**：
1. 查询 `agent_tool_executions`（按时间范围）→ 找到 7 条记录
2. 发现 submit-task 的 input 中 `planId: "plan_incremental"`（不是真实的 MongoDB ObjectId）

**关键发现**：
```
error: orchestration_api_request_failed: POST /planner/submit-task returned 500;
       response={"statusCode":500,"message":"Internal server error"}
input: { planId: "plan_incremental", action: "new", title: "step1: 选定最高优先级需求", ... }
```

**500 根因**：
- `incremental-planning.service.ts:661` → `planModel.findById("plan_incremental")`
- `"plan_incremental"` 不是合法的 24 位 hex MongoDB ObjectId
- Mongoose `findById()` 内部 `new Types.ObjectId("plan_incremental")` 抛出 `CastError`
- NestJS 未注册自定义 ExceptionFilter → CastError 作为 500 返回

### 阶段 3：追查 planId 为什么是 "plan_incremental"

**疑问**：planId 应该是 MongoDB ObjectId，为什么 Agent 传了 "plan_incremental"？

**排查步骤**：
1. 完整阅读 `buildIncrementalPlannerPrompt`（planner.service.ts:487-641）→ **整个方法中没有注入 planId**
2. 查看 `tool-execution-dispatcher.service.ts:162-163` → submit-task 只传 `parameters`，**没有传 `executionContext`**
3. 查看 `orchestration-tool-handler.service.ts:362` → `planId = String(params?.planId || '').trim()` → **完全依赖 LLM 传参**

**根因结论**：planId 传递链路存在两处断裂：
- Prompt 中没有告诉 LLM 真实 planId → LLM 幻觉填写 `"plan_incremental"`
- 工具分发层没有从 `executionContext.collaborationContext.planId` 覆写 → 幻觉值直达后端

### 阶段 4：分析计划 69c82978 的空响应问题

**疑问**：3 次都返回 `responseLen=0`，Agent 到底输出了什么？

**排查步骤**：
1. 查看 agent_messages：每个 run 中 assistant 的最后一条 content 为空
2. 查看 agents-app.log：
   - Run 2 Round 1: `responseLength=410`（确认性文本）
   - Run 2 Round 2: `responseLength=1713`（含 tool_call）
   - egress: `responseLength=0`
3. 查看 agent_parts：发现 `after_step_hook_retry` 事件（Round 1 确认性文本触发 hook retry）

**发现**：LLM 在 Round 2 输出了 `<tool_call>` 标签，但 `extractToolCall()` 解析 JSON 失败返回 null → `stripToolCallMarkup()` 删除标签后内容变空 → return ""

### 阶段 5：验证 JSON 解析失败的具体原因

**疑问**：`<tool_call>` 内的 JSON 为什么解析失败？

在修复后的重跑验证中（计划 69c82ec5），新增的 `tool_call_parse_failed` 日志捕获到了原始内容：

```
preview="<tool_call>{"tool":"builtin.sys-mg.mcp.orchestration.submit-task",
"parameters":{"planId":"unknown","action":"new","title":"step2 确认需求范围",
"description":"【锚定需求】requirementId=<step1输出的ID>, 标题=<step1输出的标题>
输入：step1 输出的 requirementId + 标题 + 需求描述原文。
..."}}}</tool_call>"
```

手动测试验证：
```javascript
JSON.parse(raw) // → Bad control character in string literal at position 190
// 原因 1: description 字段中包含实际换行符 \n（0x0a），JSON 规范要求必须是 \\n
// 原因 2: 末尾多了一个 }（三个 }}} 而非两个 }}）
```

### 阶段 6：验证多任务批量提交问题

在修复 planId 和 JSON 解析问题后（计划 69c82ec5），新的问题暴露：

**现象**：Agent 在单个 run 中连续 5 次调用 submit-task，一口气创建了全部 5 个 step 的任务。

**疑问**：为什么 Agent 不是每次只生成 1 个任务？

**排查**：
1. 查看 Prompt → 第 566 行有"每次只生成一个步骤对应的任务"但只是自然语言约束
2. Agent Runtime 的 tool-calling 循环在工具执行成功后继续让 LLM 输出 → LLM 看到 submit-task 成功后又调用下一个
3. `agent_tool_executions` 确认 5 次 submit-task 全部成功

---

## 三、根因汇总

| # | 根因 | 影响范围 | 严重程度 |
|---|---|---|---|
| 1 | Prompt 中未注入真实 planId → LLM 幻觉填写 | submit-task/report-task-run-result 全部 500 | 致命 |
| 2 | 工具分发层未从 executionContext 覆写 planId | 同上 | 致命 |
| 3 | `submitPlannerTaskFromTool` 缺少 ObjectId 格式校验 → CastError → 500 | 错误信息不明确 | 高 |
| 4 | `parseToolCallPayload` 不处理实际换行符和多余 `}` | `<tool_call>` 解析失败 → response 变空 | 致命 |
| 5 | `stripToolCallMarkup` 删除 `<tool_call>` 后信息完全丢失 | 无法排查，也无法 fallback | 高 |
| 6 | LLM 首轮输出确认性文本 | 浪费 1 轮 tool round | 中 |
| 7 | submit-task 成功后 tool-calling 循环未中断 | Agent 批量创建全部任务，违反增量编排设计 | 高 |

---

## 四、修复方案与代码变更

### 修复 1：planId 覆写（P0）

**文件**：`backend/apps/agents/src/modules/tools/tool-execution-dispatcher.service.ts`

```diff
 case 'builtin.sys-mg.mcp.orchestration.submit-task':
-  return this.orchestrationToolHandler.submitOrchestrationTask(parameters);
+  return this.orchestrationToolHandler.submitOrchestrationTask(parameters, executionContext);
 case 'builtin.sys-mg.mcp.orchestration.report-task-run-result':
-  return this.orchestrationToolHandler.reportOrchestrationTaskRunResult(parameters);
+  return this.orchestrationToolHandler.reportOrchestrationTaskRunResult(parameters, executionContext);
```

**文件**：`backend/apps/agents/src/modules/tools/builtin/orchestration-tool-handler.service.ts`

两个方法（`submitOrchestrationTask`、`reportOrchestrationTaskRunResult`）新增 `executionContext` 参数，优先从 `executionContext.collaborationContext.planId` 获取真实 planId：

```typescript
const contextPlanId = String(executionContext?.collaborationContext?.planId || '').trim();
const paramPlanId = String(params?.planId || '').trim();
const planId = contextPlanId || paramPlanId;
```

### 修复 2：Prompt 注入真实 planId（P1）

**文件**：`backend/src/modules/orchestration/planner.service.ts`

```diff
-const prompt = this.buildIncrementalPlannerPrompt(context, { domainType: planDomainType });
+const prompt = this.buildIncrementalPlannerPrompt(context, { domainType: planDomainType, planId });
```

方法签名增加 `planId` 参数，在 prompt 开头注入：
```
调用 submit-task 时，planId 参数必须填写: {planId}
```

### 修复 3：ObjectId 格式校验（P2）

**文件**：`backend/src/modules/orchestration/services/incremental-planning.service.ts`

在 `submitPlannerTaskFromTool` 和 `reportTaskRunResultFromTool` 中 `findById` 前增加：
```typescript
if (!Types.ObjectId.isValid(planId)) {
  throw new NotFoundException(`Plan not found: invalid planId format "${planId}"`);
}
```

### 修复 4：JSON 解析增强容错

**文件**：`backend/apps/agents/src/modules/agents/agent-executor.helpers.ts`

新增 `sanitizeJsonString`：将实际换行符 `\n` → `\\n`，`\r` → `\\r`，`\t` → `\\t`，移除控制字符，移除尾部多余逗号。

`parseToolCallPayload` 增强：对每个候选文本先尝试原始解析，失败后尝试 sanitize 后解析，再失败则逐步移除尾部多余 `}` 重试（最多 3 次）。

### 修复 5：空响应防御与诊断日志

**文件**：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`

1. `extractToolCall` 返回 null 但 response 含 `<tool_call>` 时，记录 `[tool_call_parse_failed]` 警告日志（含 response preview）
2. `stripToolCallMarkup` 后内容为空但原始 response 非空时，回退为 `response.replace(/<\/?tool_call>/gi, '').trim()`，避免信息完全丢失

### 修复 6：Prompt 强化 — 禁止确认性文本 + 单任务约束

**文件**：`backend/src/modules/orchestration/planner.service.ts`

在 `buildIncrementalPlannerPrompt` 顶部增加行为约束块：
```
【最高优先级行为约束】
- 你的第一条回复必须是 <tool_call> 工具调用，禁止输出任何确认性文本
- 每次回复只允许包含一个 <tool_call> 标签，标签外不要有其他文本
- 每次调用只提交一个 submit-task。提交成功后必须立即停止，不要继续提交后续步骤。
  系统会在任务执行完成后自动再次调用你生成下一步。
```

### 修复 7：submit-task 成功后 early return

**文件**：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`

在工具执行成功后，检测到 `submit-task` 且返回值含 `taskId` 时，直接 `return JSON.stringify(toolResultPayload)` 中断 tool-calling 循环：

```typescript
if (normalizedToolCallId === 'builtin.sys-mg.mcp.orchestration.submit-task' && toolResultPayload?.taskId) {
  // ... persistStepMessage + return earlyResult
}
```

这确保每次 planner run 最多只创建 1 个任务，由编排系统的状态机驱动下一轮。

---

## 五、验证结果

### 计划 69c8325712cff082b097ff8c（最终验证）

| 指标 | 修复前 | 修复后 |
|---|---|---|
| submit-task 工具调用 | 500 CastError / JSON 解析失败 | **成功** |
| planner 响应 | 空字符串 / 纯文本摘要 | `{"taskId":"69c8325c...","plannerAction":"new",...}` |
| planner_parse_fail | 每次都触发 | **无** |
| 任务创建数量 | 0 个（失败）或 5 个（批量） | **1 个**（符合增量设计） |
| 四阶段流转 | 卡在 generating | generate → pre_execute → executing → post_execute → idle |
| 计划最终状态 | draft (失败回退) | **planned** |
| generationState.totalGenerated | 0 | **1** |
| generationState.consecutiveFailures | 3~6 | **0** |

---

## 六、防御纵深

三层修复形成纵深防御：

1. **工具层 planId 覆写**（最可靠）：即使 LLM 幻觉填写错误 planId，executionContext 中的真实 planId 会覆盖
2. **Prompt 层 planId 注入**（辅助）：告诉 LLM 正确的 planId 值，减少幻觉概率
3. **后端 ObjectId 校验**（兜底）：非法 ObjectId 不再触发 500 CastError，而是清晰的 404
4. **JSON 容错**（鲁棒性）：处理 LLM 常见的 JSON 缺陷（换行符、多余括号）
5. **submit-task early return**（语义正确性）：从 runtime 层保证增量编排每次只创建 1 个任务

---

## 七、变更文件清单

| 文件 | 改动类型 |
|---|---|
| `backend/apps/agents/src/modules/tools/tool-execution-dispatcher.service.ts` | submit-task/report-task-run-result 传入 executionContext |
| `backend/apps/agents/src/modules/tools/builtin/orchestration-tool-handler.service.ts` | planId 从 executionContext 覆写 |
| `backend/apps/agents/src/modules/agents/agent-executor.helpers.ts` | sanitizeJsonString + parseToolCallPayload 容错增强 |
| `backend/apps/agents/src/modules/agents/agent-executor.service.ts` | tool_call_parse_failed 日志 + strip 回退 + submit-task early return |
| `backend/src/modules/orchestration/planner.service.ts` | planId 注入 prompt + 行为约束强化 |
| `backend/src/modules/orchestration/services/incremental-planning.service.ts` | ObjectId 格式校验 |

---

## 八、经验教训

1. **不要让 LLM 填写系统级 ID**：planId、taskId 等系统生成的标识符不应依赖 LLM 传参，应从上下文自动注入/覆写
2. **<tool_call> JSON 解析必须高度容错**：LLM 输出的 JSON 常见缺陷包括实际换行符、多余括号、尾部逗号，必须全部处理
3. **信息不能静默丢失**：`stripToolCallMarkup` 把内容清空为空字符串后完全无法排查，必须保留 fallback 和诊断日志
4. **自然语言约束不可靠**：Prompt 中写"每次只生成一个任务"不足以阻止 LLM 连续调用工具，必须在 runtime 层用代码强制
5. **CastError 必须处理**：Mongoose 的 `findById` 对非法 ObjectId 格式会抛 CastError，NestJS 默认返回 500，应提前校验
