# [已弃用] ORCHESTRATION_PLANNER_AGENT_SELECTION_FIX_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration Planner Agent 选择决策修复方案

## 背景

在 [Test-2] Agency-Agents Prompt 全量导入计划（planId: 69c181d953a3c074f2eca7f6）的执行过程中，Planner（Kim-CTO, agent:698a0bd7db9f7e6b8cca4171）暴露出严重的 agent 选择决策问题，导致 13 个任务全部未能完成实际目标。

### 现象

1. **工具匹配规则被系统性忽略**：prompt 中明确注入了 `## 执行者选择规则` 规则 A（工具匹配优先），且 Agent Manifest 中包含 Docter-W（repo-read + repo-writer + save-prompt-template + web-search + web-fetch 全匹配）和 Coder-T（repo-read + repo-writer + save-prompt-template），但 Planner 在 13 次决策中从未选择这两个 agent。

2. **重复分配给已知无工具的 agent**：Task 0/1 分给小武（仅有 repo-read），失败后 Task 10-12 又分给小武做 research 任务（需要 web-search/web-fetch），明显违反规则 7（避免重复同一路径）。

3. **失败后进入"研究取证"死循环**：Task 2-12 共 11 个 research 任务本质相同——确认仓库可访问性和寻找有工具的 agent。Planner 将"纠偏"理解为"在相同类型任务描述中加更多细节"，而非"换一个有正确工具的 agent 来执行实际动作"。

4. **将实质失败的任务视为已完成**：Task 0/1 的产出为"我无法按你的验收标准实际完成这三步"，Planner 在后续规划中读到 outputSummary 却未识别出任务实质未完成。

5. **失败后追加新任务而非重新设计失败任务**：每次任务失败后 Planner 都创建全新任务，导致任务清单膨胀至 13 个，其中大量重复无效。

### 根因分析

Planner 的决策完全依赖 LLM 对 prompt 的遵从性。当前 prompt 中的 agent 选择规则（`planner.service.ts:347-352`）是**建议性**的自然语言，LLM 可以忽略：

```
A) **工具匹配优先**：查看每个 agent 的"工具"列表，选择拥有本任务所需工具的 agent。
B) **多人有工具时可委派**：优先选择职级更低/更专注的执行者。
C) **仅自己有工具时必须选自己**。
D) **无工具需求时按能力匹配**。
```

此外，失败任务的上下文（`## 失败任务（请调整策略）`）只传递了 title 和 error 文本（`incremental-planning.service.ts:299-304`），没有传递**失败任务的 agentId**——Planner 无法直接看到"这个 agent 已经失败过，不应再选它"。

## 核心目标

1. 让 Planner 在决策时有效执行工具匹配规则，不再将任务分配给明显缺少所需工具的 agent
2. 让 Planner 在任务失败后能有效纠偏——识别失败 agent 并切换到有工具的候选
3. 让 Planner 在面对"虚假完成"时具备识别能力

## 影响范围

| 层级 | 影响 |
|------|------|
| **Planner Service** | `planner.service.ts` — prompt 构建优化（失败上下文增强、规则强化） |
| **Incremental Planning Service** | `incremental-planning.service.ts` — 失败任务上下文补充 agentId |
| **Schema** | 无变更 |
| **前端** | 无影响 |

## 执行步骤

### Step 1: 失败任务上下文补充 agentId

**关键影响点**: 后端 — `incremental-planning.service.ts`

当前 `buildPlannerContext()` 中 failedTasks 只包含 `title` 和 `error`（line 299-304），Planner 看不到是哪个 agent 失败的。

- 在 `failedTasks` 映射中增加 `agentId` 字段：
  ```typescript
  const failedTasks = tasks
    .filter((item) => item.status === 'failed')
    .map((item) => ({
      title: item.title,
      agentId: item.assignment?.executorId,  // 新增
      error: String(item.result?.error || 'Unknown error'),
    }));
  ```
- 在 `buildIncrementalPlannerPrompt` 的失败任务输出格式中展示 agentId：
  ```
  - [title] (agent=xxx): error
  ```

### Step 2: 强化 Planner Prompt 中的工具匹配约束

**关键影响点**: 后端 — `planner.service.ts`

将规则 A 从建议性措辞改为**强制性禁令**，并追加负面示例：

```
A) **工具匹配优先（强制）**：
   - 确定本任务需要哪些工具（如 repo-writer、save-prompt-template、web-search 等）
   - 逐个检查 Agent Manifest 中每个 agent 的工具列表
   - 【禁止】将任务分配给缺少所需工具的 agent，即使该 agent 在其他方面匹配
   - 若无任何 agent 拥有所需工具，必须在 reasoning 中说明并设计替代方案
```

### Step 3: 增加"已失败 agent 回避"规则

**关键影响点**: 后端 — `planner.service.ts`

在 `## 执行者选择规则` 中新增规则 E：

```
E) **失败回避**：若某 agent 在本计划中已因"缺少工具"或"工具不匹配"而失败，
   【禁止】再次将同类任务分配给该 agent。必须从失败任务的 agent 列表中排除后重新选择。
```

### Step 4: 增加"虚假完成"识别提示

**关键影响点**: 后端 — `planner.service.ts`

在 `## 已完成任务摘要` 注入逻辑后，追加注意事项：

```
注意：如果已完成任务的 outputSummary 中包含"无法执行""无法完成""缺少工具""没有权限"等语义，
该任务可能是"虚假完成"（agent 报告了无法执行但被系统标记为已完成）。
遇到此情况时，应将该任务视为未完成，重新规划。
```

### Step 5: 失败后策略约束——必须更换 agent 或调整 taskType

**关键影响点**: 后端 — `planner.service.ts`

将规则 7 从"避免重复同一路径"改为更具体的约束：

```
7) 当存在失败任务时，下一步【必须】满足以下至少一项纠偏条件：
   a) 更换执行 agent（选择与失败 agent 不同的候选）
   b) 更换任务类型（taskType）
   c) 根本性地改变任务描述和执行路径
   仅修改任务描述的细节（如增加更多解释）不视为有效纠偏。
```

## 风险与应对

| 风险 | 应对措施 |
|------|---------|
| Prompt 加长后影响 LLM token 成本 | 新增约束总计约 300 token，可接受 |
| 禁令措辞过强导致 LLM 过度保守 | 保留规则 D 作为 fallback（无工具需求时可按能力匹配） |
| LLM 仍概率性忽略规则 | 系统层面增加 agent-task 工具适配性校验作为兜底（见系统修复方案） |

## 依赖关系

- 关联方案：`ORCHESTRATION_TASK_OUTPUT_VALIDATION_FIX_PLAN.md`（系统层面校验兜底）
- 关联方案：`ORCHESTRATION_INCREMENTAL_PLANNING_FAILOVER_FIX_PLAN.md`（系统层面失败重试机制改进）
- 前置完成：`ORCHESTRATION_PLANNER_JSON_CONFORMANCE_PLAN.md`（已完成 ✅）
