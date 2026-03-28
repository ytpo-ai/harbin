# Fix: Development 计划任务生成偏离 — Skill 驱动改造

- 日期: 2026-03-29
- 类型: fix + refactor
- 影响范围: orchestration planner、rd-workflow skill、plan-management、PlanHeader
- Commit: `11371c4`

---

## 一、问题起源

用户创建了一个 `domainType=development` 的计划（plan ID: 69c7e5d75a6dfb7500dd8470），使用 rd-workflow 流程（sourcePrompt 为 rd.md 全文 96 行）。期望 Planner 按 step1→step5 顺序生成可执行任务，但实际生成的第一个任务是：

> "梳理目标与约束并生成合法 runtimeTaskType 任务草案"

这是一个**元规划任务**——Planner 在规划"如何做规划"，而非按 rd-workflow 定义的 step1"选定最高优先级需求"生成业务任务。

---

## 二、追溯流程与分阶段发现

### 阶段 1：sourcePrompt 注入方式分析

**疑问**：为什么 Planner 会生成"元任务"而非业务任务？

**追溯**：检查 `buildIncrementalPlannerPrompt()` (planner.service.ts:468-568)，发现 sourcePrompt（rd.md 全文）被直接拼入 `## Plan 目标` 区域。rd.md 包含大量"规则性"语言（"Planner 必须遵守"、"强制"、"禁止"）和模板变量 `${info.requirementId}`。

**结论**：LLM 面对混杂的元指令和业务步骤定义，无法区分"给 Planner 的约束"和"给执行者的业务步骤"，导致它进入"元层"——生成描述规划流程的任务而非执行步骤。

### 阶段 2：方案选型讨论

**疑问**：如何让 Planner 正确区分元指令和业务步骤？

提出 4 个方向：
- A: 结构化包装 sourcePrompt（解析步骤，只注入当前 step）
- B: 步骤感知的增量规划（预解析步骤列表）
- C: 最小改动加强边界标记
- D: 混合方案

**用户选择**：将 rd.md 流程定义作为 **Skill** 注入给 Planner agent（通过 system message），sourcePrompt 精简为引导语。

### 阶段 3：Skill 注入机制验证

**疑问**：不使用 `precise` 模式，standard 模式下 rd-workflow skill 是否会自动激活？

**追溯**：走读 `context-strategy.service.ts` 的 `shouldActivateSkillContent()` 匹配逻辑。rd-workflow 的 tags 包含 `"planning"`，planner 任务的 `task.type = "planning"`，在 tag-type 匹配阶段（line 36）就会命中 `"planning".includes("planning")` → true。

**结论**：不需要 precise 模式，standard 模式下 rd-workflow 已自动激活。前提是 CTO agent 的 skills 数组中包含 rd-workflow ID。用户确认已绑定。

### 阶段 4：首次测试 — Planner 角色混淆

创建新计划（plan ID: 69c7f3cb），sourcePrompt 精简为"根据 rd-workflow 技能执行需求开发"。

**session 日志分析**：
- Message [2]：Planner 输出 `TASK_INABILITY`（而非任务 JSON）
- Message [4]：Planner 输出确认性文本（"已收到并确认遵循..."）
- Message [10]-[12]：Planner **自己调用了业务工具**（requirement.board、requirement.detail），最终输出 `TASK_INABILITY: requirement.get failed`

**疑问**：为什么 Planner 会自己去调用工具？

**根因**：rd-workflow skill 中 step1 动作描述为"调用 requirement.board 或 requirement.list 获取需求列表"——命令式措辞让 Planner 将其误解为自己要执行的操作。同时 skill 中的"需求状态更新规则（强制）"和"需求上下文获取规则（强制）"直接指示 Planner 调用工具。

**修复**：
1. 重写 rd-workflow skill（v0.4.0）：新增"Planner 角色说明"区块，去除命令式工具调用指令，删除触发工具调用的规则区块
2. 在 planner prompt 中新增"角色边界"区块：禁止调用业务工具、禁止确认文本、禁止 TASK_INABILITY

### 阶段 5：Planner-Executor Session 共享

第二次测试（plan ID: 69c7f786），skill 内容已更新。step1 **executor** 成功执行，但随后的 planner post-execute 输出了完整 5 步任务列表而非 nextAction 决策 JSON。

**疑问**：为什么 post-execute 的 Planner 输出偏了？

**追溯**：检查 session 日志发现 executor（Kim-CTO）和 planner（Kim-CTO）**共享了同一个 plan session**。

走读 `getOrCreatePlanSession()`（runtime-persistence.service.ts:281-343）：查找条件是 `planId + ownerId + sessionType='plan'`。当 planner agent 和 executor agent 是同一个 agent 时，session key 相同。

planner 的 `ensurePlannerSession`（step-dispatcher.service.ts:536-575）没有传 `orchestrationRunId`，导致 planner session 与 executor session 碰撞。

**修复**：在 `ensurePlannerSession` 中传入 `orchestrationRunId: 'planner'`，使 session ID 变为 `plan-{planId}-{agentId}-run-planner`，与 executor 的 `plan-{planId}-{agentId}` 完全隔离。

### 阶段 6：post-execute 默认 stop

**疑问**：step1 完成后为什么计划直接停止？

**追溯**：`executePostTask()` (planner.service.ts:285-347) 解析 Planner 返回的 JSON，如果 `nextAction` 不在有效值内（generate_next/redesign/retry），默认为 `'stop'`。`phasePostExecute` 中 `decision.nextAction === 'stop'` 触发 `completeAndArchive()`，设置 `isComplete=true`。

`buildPostTaskContext()` 的 prompt 没有告诉 Planner 当前是多步流程中的第几步，Planner 看到 step1 完成 + 有效输出，直接决策 stop。

**修复**：
1. `buildPostTaskContext` 增加 `planDomainType` 和 `totalGeneratedSteps` 参数，development 模式下注入多步流程进度提示
2. `phasePostExecute` 传入 `planDomainType` 和 `state.totalGenerated`

### 阶段 7：前端"生成下一步"按钮不可点

**疑问**：step1 完成后前端没有反应？

**追溯**：PlanHeader.tsx:133 按钮禁用条件包含 `generationCompleted`，取自 `planDetail.generationState?.isComplete`。阶段 6 中 `isComplete` 被设为 true 导致按钮永久禁用。

`generateNext` API（plan-management.service.ts:324-326）在 `isComplete=true` 时直接抛 `BadRequestException`。

**修复**：
1. `generateNext` API 改为重置 `isComplete=false`、`consecutiveFailures=0`、`currentPhase='idle'`、`status='planned'`
2. 前端 PlanHeader 移除 `generationCompleted` 禁用条件

### 阶段 8：Executor step1 偶发失败

测试计划（plan ID: 69c7f98c），step1 executor 输出 `TASK_INABILITY: 缺少 step0 输出`。

**疑问**：executor 为什么不主动查询需求池？

**分析**：task.description 中"从 EI 需求池获取需求列表"太抽象，executor 不知道用什么方式获取。加上 `upstreamOutputs 为空`，它认为缺少前置输入。

**修复**：
1. rd-workflow skill step1 动作描述改为"使用需求管理工具主动获取...本步骤无需依赖上游输入，执行者应直接查询需求池"
2. planner prompt 首步引导增加"task.description 必须明确告知执行者：本步无上游依赖"

### 阶段 9：重复生成 step1

测试计划（plan IDs: 69c7ff40, 69c80180），step1 成功完成后 Planner 继续生成 step1 而非 step2，连续生成 2-3 个 step1。

**疑问**：prompt 中已说"请生成第 2 步"，为什么 Planner 还是生成 step1？

**分析**：
1. `totalSteps` 统计的是所有任务总数（含重试），不是已完成的 skill 步骤数
2. 已完成任务摘要中没有标注对应的 skill step 编号
3. Planner 在 session 中看到之前自己输出的 step1 JSON，延续了生成模式

**修复**：
1. 步骤计数改用 `completedTasks.length`（已成功完成数）而非 `totalSteps`
2. 新增"步骤进度"区块：明确"你现在必须生成 step{N}"、"禁止生成 step1~step{N-1}"
3. 已完成任务摘要中每项标注 `(对应 skill step{i})`

### 阶段 10：需求状态未更新为 assigned

用户发现选中的需求状态没有从 todo 变为 assigned。

**疑问**：谁负责更新需求状态？

**讨论**：最初修改 rd-workflow 时删除了"需求状态更新规则"（因为它导致 Planner 调用工具）。但需求状态更新是合理的业务需求。

**用户明确**：应由 Planner 在 **phasePreExecute 阶段**调用工具更新状态，不需要改代码——Planner 在 pre-execute 阶段有工具调用能力，skill 内容已注入。

**修复**：在 rd-workflow skill 中恢复需求状态更新规则，限定在 pre-execute 阶段执行。不改代码。

---

## 三、完整修改清单

### 代码改动（4 个 backend 文件 + 1 个 frontend 文件）

| 文件 | 改动 |
|------|------|
| `planner.service.ts` | `generateNextTask` 读取 plan.domainType 传入 prompt 构建；`buildIncrementalPlannerPrompt` 新增 development 模式：角色边界、步骤引导、步骤进度、首步引导、已完成任务 step 标注 |
| `orchestration-context.service.ts` | `buildPostTaskContext` 增加 `planDomainType`/`totalGeneratedSteps`，development 模式注入多步流程进度提示 |
| `orchestration-step-dispatcher.service.ts` | `ensurePlannerSession` 传入 `orchestrationRunId: 'planner'` 隔离 session；`phasePostExecute` 传入新参数 |
| `plan-management.service.ts` | `generateNext` 移除 isComplete 拒绝逻辑，改为自动重置 |
| `PlanHeader.tsx` | "生成下一步"按钮移除 `generationCompleted` 禁用条件 |

### Skill 改动（1 个文件）

| 文件 | 改动 |
|------|------|
| `docs/skill/rd-workflow.md` | v0.3.0→v0.4.0：新增 Planner 角色说明、去除命令式工具调用、step1 动作描述优化、恢复 pre-execute 阶段需求状态更新规则 |

### 未改动但确认过的文件

- `context-strategy.service.ts`：standard 模式下 rd-workflow 已自动激活（tag-type 匹配），无需改动
- `collaboration-context.factory.ts` / `types.ts`：不需要扩展 skillIds 类型，不使用 precise 模式
- `orchestration-plan.schema.ts`：schema 已支持 skillActivation.skillIds，无需改动

---

## 四、待验证项

1. **步骤推进**：新计划中 step1→step2→step3 是否正确推进（步骤进度引导 + 禁止重复已完成步骤）
2. **需求状态更新**：pre-execute 阶段 Planner 是否按 skill 规则调用工具更新需求状态
3. **post-execute 决策**：Planner 是否稳定返回 `generate_next` 而非 stop
4. **session 隔离**：planner session 和 executor session 是否互不干扰
5. **端到端完成**：5 步流程（step1→step5）能否完整走完
