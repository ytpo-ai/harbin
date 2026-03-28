# Fix 记录：重新编排(replan)Planner 连续拒绝生成任务 — 完整追溯

## 1. 基本信息

- 标题：重新编排(replan)时 Planner 因多层上下文缺失/规则冲突连续拒绝生成任务
- 日期：2026-03-28
- 负责人：AI Agent
- 关联 plan：`69c6d2d0496cf4b31ee48065`、`69c6dd31494ff1c89eab67be`
- 是否落盘（用户确认）：是
- 修复 commit：`f907519` → `89516b6` → `2426eb8` → `87cdfe2`（共 4 层递进修复）

---

## 2. 问题追溯全过程

### 2.1 第一轮：用户报告 "No requirementId" 错误

**用户报告**：
> 重新编排失败：`Planner returned empty task definition: No requirementId/meeting context/plan context provided; cannot generate next task deterministically under rd-workflow anchoring rules.`

**第一个疑问：这个错误消息来自代码还是 LLM？**

搜索代码发现 `"No requirementId/meeting context/plan context provided"` 这个字符串**不存在于代码库中**。进一步追溯发现它是 Planner LLM 返回的 `reasoning` 字段值，被 `buildEmptyTaskReason(reasoning)` 拼接为完整错误消息：
```
Planner returned empty task definition: <LLM返回的reasoning>
```
该方法定义在 `incremental-planning.service.ts:946` 和 `orchestration-step-dispatcher.service.ts:609`。

**第二个疑问：`tryBackfillRequirementId` 是否触发了？**

追溯调用链：
```
phasePostExecute() → sceneOptimizationService.applyPostExecuteOptimizations()
  → rule.match(): planDomainType === 'development' && taskStatus === 'completed'
    → tryBackfillRequirementId()
```

触发条件是 `phasePostExecute` 阶段且某个任务 `status === 'completed'`。但 replan 时问题发生在 `phaseGenerate`（第一步任务生成阶段），还没有任何任务被执行。**结论：tryBackfillRequirementId 不可能触发。**

**第三个疑问：replan 时 requirementId 是否被保留？**

追溯 `replanPlan()` 代码（`plan-management.service.ts:425-565`）：
- Line 446：`const requirementId = this.contextService.resolveRequirementIdFromPlan(plan)`（从旧 plan 读取）
- Line 450：`await this.orchestrationTaskModel.deleteMany({ planId })`（删除所有旧任务）
- Line 510：`...(requirementId ? { 'metadata.requirementId': requirementId } : {})`（如果有则写回）

**metadata.requirementId 在 replan 时被保留了。** 但它有没有被传到 planner？

**第四个疑问：planner 为什么看不到已保留的 requirementId？**

追溯数据流：
1. `startGeneration()` → `stepDispatcher.advanceOnce()` → `phaseGenerate()`
2. `phaseGenerate()` 调用 `buildPlannerContext(planId, sourcePrompt)`
3. `buildPlannerContext()` 返回 `IncrementalPlannerContext`
4. 检查 `IncrementalPlannerContext` 接口定义（`planner.service.ts:33-49`）：**没有 `requirementId` 字段**
5. `buildIncrementalPlannerPrompt()` 中 `extractRequirementAnchor()` 只从以下来源正则提取：
   - `context.planGoal`（sourcePrompt 原文）
   - `context.completedTasks`（replan 后为空数组）
   - `context.failedTasks`（replan 后为空数组）

**根因确认：`plan.metadata.requirementId` 被保留了，但 `buildPlannerContext` 没有将它传入 context，`extractRequirementAnchor` 无从获取。**

**修复 A（commit f907519）**：
1. `IncrementalPlannerContext` 接口新增 `requirementId?: string`
2. `buildPlannerContext` 从 `plan.metadata.requirementId` 读取并填入 context
3. `extractRequirementAnchor` 优先使用 `context.requirementId`

---

### 2.2 第二轮：用户报告 "missing_task_context" 错误

**用户报告**：
> 重新编排失败：`Planner returned empty task definition: missing_task_context`

**第一个疑问：上次的 requirementId 修复是否生效了？**

检查 dist 编译产物：
- `backend/dist/.../planner.service.js` 时间戳 `03:29`，包含 `context.requirementId`
- `backend/dist/.../incremental-planning.service.js` 包含 `resolveRequirementIdFromPlan` 两处引用

修复代码已编译。但 planner 日志（03:30:32）仍显示 "no requirementId"。

**第二个疑问：这个 plan 的 metadata.requirementId 到底是什么？**

查数据库确认：
```javascript
metadata: {
  "requestedPlannerAgentId": "698a0bd7db9f7e6b8cca4171",
  "replanStartedAt": "2026-03-27T19:30:30.332Z",
  "planningFailedAt": "2026-03-27T19:30:36.570Z"
}
// 没有 requirementId 字段！
```

**关键发现：这个 plan 的 `metadata.requirementId` 本来就是空的。** 它从未成功完成过 step1（选定需求），所以 `tryBackfillRequirementId` 从未成功回填过。修复 A 对有 requirementId 的场景有效，但对这个 plan 无效。

**第三个疑问：无 requirementId 时 planner prompt 怎么处理的？**

追溯 `buildIncrementalPlannerPrompt()` 逻辑：
- `requirementAnchor.requirementId` 为空
- `context.totalSteps === 0`（replan 后无任务）
- 走进"首步豁免"分支：告诉 planner "必须立即生成第一个任务"

但 `sourcePrompt` 是 rd-workflow skill 的完整文本（3334 字符）。数据库查证：
- `sourcePrompt` 包含 `${info.requirementId}`（未替换的占位符）
- 包含"必须先调用 `requirement.get` 获取需求详情"
- 包含"若工具不可用或调用失败，请直接输出 `TASK_INABILITY`"

**根因确认：首步豁免指令与 sourcePrompt 中 rd-workflow skill 的强制规则矛盾。planner LLM 选择遵从 sourcePrompt 中更具体的约束，输出 TASK_INABILITY。**

查日志验证（三次重试）：
1. `TASK_INABILITY: missing actionable planning input (no requirementId, no backlog filter, no meeting/plan context)`
2. `{}`
3. `{"result":"TASK_INABILITY","reason":"missing_task_context",...}`

**修复 B（commit 89516b6）**：增强首步豁免为 6 条最高优先级规则，明确覆盖 sourcePrompt 中的所有前置约束（requirement.get、TASK_INABILITY、占位符等）。

---

### 2.3 第三轮：用户报告 "ok" 错误

**用户报告**：
> 重新编排失败：`Planner returned empty task definition: ok`

**第一个疑问："ok" 从哪来的？**

查日志：
```json
// 第3次重试
{"result":"ok","task":"incremental_planning_next_task",
 "selectedRequirement":{"requirementId":"req-1774625464365-82z8ro","title":"计划详情页-停止执行加图标",...},
 "nextTask":{"name":"step1_scope_and_dispatch","goal":"确认需求范围并进入执行分配","actions":[...]}}
```

planner 这次**确实返回了有效内容**！`resolvePlannerReasoning` 从 `parsed.result` 提取到 `"ok"`。但 `validatedTask` 仍然是 `undefined`。

**第二个疑问：为什么 nextTask 被识别但 validatedTask 为空？**

追溯解析链：
1. `resolvePlannerTaskCandidate(parsed)` → 识别 `parsed.nextTask`（有 `nextTask` 字段） ✓
2. 构建 `parsedTask`：
   - `title = String(taskCandidate.title || '').trim()` → **空字符串**（nextTask 里是 `name` 不是 `title`）
   - `description = String(taskCandidate.description || '').trim()` → **空字符串**（nextTask 里是 `goal` 不是 `description`）
3. `validatedTask = parsedTask.title && parsedTask.description ? parsedTask : undefined` → **undefined**

**根因确认：planner 返回了 `name/goal` 字段名，代码只识别 `title/description`。**

**修复 C（commit 2426eb8）**：增加 fallback 映射：`title || name`、`description || goal`。

---

### 2.4 第四轮：用户报告 "json_only_mode_conflict_with_tool_call_tag" 错误

**用户报告**：
> 重新编排失败：`Planner returned empty task definition: json_only_mode_conflict_with_tool_call_tag`

**注意**：这次是新 plan `69c6dd31494ff1c89eab67be`（用户重新创建了计划再 replan）。

**第一个疑问：planner 返回了什么？**

查日志（三次重试）：
1. 有 `nextTask` 但只包含 `requirementId/title/priority/status/action`（需求元信息，不是任务定义）
2. 有 `nextTask` 但字段是 `step/action/selection/executionHints`（执行计划，不是 task schema）
3. `{"result":"error","reason":"json_only_mode_conflict_with_tool_call_tag"}`

**第二个疑问：为什么 planner 不输出符合 schema 的 JSON？**

分析 prompt 中的三组互相矛盾的规则：

| 规则 | 位置 | 要求 |
|---|---|---|
| 首步豁免 | `## 上下文锚点` | "必须立即生成任务" |
| 执行者发现步骤 第4条 | `## 执行者发现步骤` | "若本轮未调用 list-agents，不允许输出 task" |
| JSON-only 模式 | prompt 最顶部 | "仅输出 JSON" |

planner 被要求：
1. 先调用 `list-agents` 工具获取 agent 列表（执行者发现步骤）
2. 仅输出 JSON（JSON-only 模式）
3. 但工具调用需要输出非 JSON 的工具调用标签

第 3 次响应 `json_only_mode_conflict_with_tool_call_tag` 直接说明了这个冲突。前两次响应则是 planner 尝试"折衷"——不调用工具而是把执行计划嵌入 JSON，但字段结构不符合 schema。

**根因确认：首步豁免说"必须生成任务"，但执行者发现步骤第 4 条说"不调用 list-agents 就不许输出 task"。首步豁免未覆盖这条规则。**

**修复 D（commit 87cdfe2）**：
1. 首步豁免中明确 **豁免 list-agents 前置调用**，无需调用任何工具，无需填写 agentId
2. 提供完整的 JSON 模板示例，planner 只需替换 description 内容，消除 schema 偏差

---

## 3. 四层问题总结

```
replan
  ├─ [有 requirementId 的 plan] → 修复 A：metadata 透传
  └─ [无 requirementId 的 plan] → totalSteps=0 走首步豁免
       ├─ sourcePrompt 中 rd-workflow 规则压制首步豁免 → 修复 B：增强豁免指令
       ├─ planner 返回 name/goal 别名字段不识别 → 修复 C：fallback 映射
       └─ list-agents 前置调用与 JSON-only 模式冲突 → 修复 D：豁免 + 模板
```

### 按 commit 时间线

| # | Commit | 错误现象 | 根因 | 修复 |
|---|---|---|---|---|
| 1 | `f907519` | `No requirementId/meeting context/plan context provided` | `buildPlannerContext` 未透传 `plan.metadata.requirementId` | 接口新增字段 + 读取 metadata + extractRequirementAnchor 优先使用 |
| 2 | `89516b6` | `missing_task_context` | sourcePrompt(rd-workflow) 中的强制规则压制首步豁免 | 增强豁免为 6 条最高优先级覆盖规则 |
| 3 | `2426eb8` | `ok`（实际有内容但字段名不对） | planner 返回 `name/goal` 而非 `title/description` | fallback：`title\|\|name`、`description\|\|goal` |
| 4 | `87cdfe2` | `json_only_mode_conflict_with_tool_call_tag` | 执行者发现步骤第4条与首步豁免/JSON-only 模式三方矛盾 | 首步豁免 list-agents + 提供 JSON 模板 |

---

## 4. 涉及文件变更明细

### `backend/src/modules/orchestration/planner.service.ts`

| 位置 | 变更内容 | 涉及修复 |
|---|---|---|
| Line 49 | `IncrementalPlannerContext` 接口新增 `requirementId?: string` | A |
| Line 211-212 | `parsedTask` 构建增加 `title\|\|name`、`description\|\|goal` fallback | C |
| Line 660-662 | `extractRequirementAnchor` 优先使用 `context.requirementId` | A |
| Line 499-510 | 首步豁免从 3 条扩展为完整的覆盖指令（含 list-agents 豁免 + JSON 模板） | B + D |

### `backend/src/modules/orchestration/services/incremental-planning.service.ts`

| 位置 | 变更内容 | 涉及修复 |
|---|---|---|
| Line 551-553 | `buildPlannerContext` 调用 `resolveRequirementIdFromPlan` 填入 context | A |

---

## 5. 关键排查方法与数据来源

| 排查手段 | 用途 | 示例 |
|---|---|---|
| 代码全文搜索 | 确认错误消息来源（代码 vs LLM） | `grep "No requirementId"` → 未命中 → 来自 LLM reasoning |
| 调用链追溯 | 确认 tryBackfillRequirementId 触发条件 | `phasePostExecute` → `taskStatus === 'completed'` → replan 时不可能触发 |
| 接口定义检查 | 发现 `IncrementalPlannerContext` 缺少 requirementId | `planner.service.ts:33-49` |
| 数据库查询 | 确认 plan.metadata 实际值 | `metadata` 无 requirementId → 从未回填成功 |
| Planner 日志分析 | 查看 LLM 原始响应 | `grep "planner_raw_response"` → 发现 name/goal 字段名偏差 |
| Dist 产物检查 | 确认修复代码已编译 | `grep "context.requirementId" dist/...` |
| Prompt 内容分析 | 发现规则冲突 | sourcePrompt 含 `${info.requirementId}` 未替换 + list-agents 强制调用 vs JSON-only |

---

## 6. 风险与后续

- **已知风险**：首步豁免中提供 JSON 模板可能导致 planner 对首步任务过度依赖模板；但"选定需求"是确定性任务，可接受
- **后续优化**：
  1. 在 `buildPlannerContext` 中同时传入 `requirementTitle`
  2. 长期方案：对 sourcePrompt 中的模板变量（`${info.requirementId}` 等）在注入 planner prompt 前做预处理替换或移除，从根本上消除指令冲突
  3. 对 `totalSteps=0` 且 sourcePrompt 为 skill 全文的场景，可考虑只注入步骤定义部分，不注入前置约束部分
  4. 可扩展别名映射覆盖更多 LLM 变体字段（`summary` → `description`、`label` → `title` 等）
  5. list-agents 前置调用的 JSON-only 冲突是一个系统性问题，后续需考虑将 planner agent 的工具调用与最终 JSON 输出分离为两阶段
