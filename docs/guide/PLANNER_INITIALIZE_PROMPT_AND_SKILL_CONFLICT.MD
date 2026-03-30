# Planner Initialize Prompt 与 Skill 指令冲突分析

## 概述

本文档记录 `phaseInitialize` 阶段 LLM 行为不稳定的根因分析，涵盖 prompt 注入链路、skill 内容注入机制、LLM 上下文中的指令冲突，以及工具调用的触发机制。

基于 2026-03-30 多轮 session 测试的实际 log 分析得出。

---

## 1. phaseInitialize 阶段的 LLM 上下文组成

当 `phaseInitialize` 触发时，LLM 收到的完整上下文由以下部分按序组成：

| 序号 | 来源 | 角色 | 内容 |
|------|------|------|------|
| 1 | `agent-runtime-baseline` skill | system | Agent 通用行为基线（工具纪律、协作委派、降级策略） |
| 2 | Agent systemPrompt | system | Agent 角色描述（如"你是CTO"） |
| 3 | Identity Context | system | Agent 身份矩阵（技能、工具集、能力域、工作风格） |
| 4 | Enabled Skills | system | 已激活 skill 全文（rd-workflow、tasktype-selection、task-out-validation） |
| 5 | 工具列表 + Tool Use Strategy | system | 可用工具清单 + 每个工具的使用策略 prompt |
| 6 | Working Environment Context | system | 编排上下文（roleInPlan、agentTier、collaborators） |
| 7 | 任务信息 | system | 任务标题、类型、优先级 |
| 8 | `buildPhaseInitializePrompt()` 输出 | user | Phase 1 + Phase 2 指令、OutlineItem Schema、约束、输入参数 |

**关键发现**：序号 4 的 skill 全文和序号 8 的 prompt 同时出现在上下文中，且都包含 phaseInitialize 阶段的工具调用指引，形成指令冲突。

---

## 2. 指令冲突的具体表现

### 2.1 两条竞争指令

**Prompt 指令**（Message #12，user 角色）：
```
Phase 1（必做）：list-agents → 生成 outline → plan-initialize(mode=outline)
Phase 2（Phase 1 完成后）：plan-initialize(mode=taskContext) → update-status
```

**Skill 指令**（Message #5，system 角色，rd-workflow 的 `## phaseInitialize 扩展步骤`）：
```
1. 调用 requirement.list(status=todo)
2. 调用 requirement.get
3. 调用 plan-initialize(mode=taskContext)
4. 调用 requirement.update-status
```

### 2.2 LLM 的选择偏好

在所有测试 session 中（6 轮以上），LLM **始终优先执行 skill 的 4 步序列，跳过 prompt 的 Phase 1**。原因：

1. **具体性差异**：Skill 的 4 步是精确的工具 ID + 参数模板，Phase 1 需要 LLM 自主推理生成 outline
2. **角色权重**：Skill 以 system 角色注入（序号 4），prompt 以 user 角色注入（序号 8）；部分 LLM 对 system 指令赋予更高优先级
3. **skill 出现在 prompt 之前**：LLM 先读到 skill 的具体步骤，形成"首因效应"

---

## 3. 工具调用触发机制

### 3.1 不存在系统级自动工具调用

经代码排查确认：**系统没有在 LLM 首次输出之前自动执行任何工具**。所有 `requirement.list` 等调用都是 LLM 在 tool-calling loop 中主动发起的。

### 3.2 tool-calling loop 流程

```
buildPhaseInitializePrompt() 输出 → 作为 user message 发给 LLM
    ↓
LLM 输出 <tool_call>...</tool_call>
    ↓
agent-executor.service.ts 解析 tool_call → 执行工具 → 结果作为 system message 注入
    ↓
LLM 收到结果 → 继续输出下一个 tool_call 或最终文本
    ↓
循环最多 DEFAULT_MAX_TOOL_ROUNDS=30 轮
```

Session log 中 system/assistant 的交替就是这个 loop 的多轮记录。

### 3.3 关键文件

| 文件 | 方法 | 职责 |
|------|------|------|
| `planner.service.ts` | `initializePlan()` | 构建 prompt → 调用 agentClientService.executeTask() |
| `planner.service.ts` | `buildPhaseInitializePrompt()` | 生成 Phase 1 + Phase 2 指令 |
| `agent-executor.service.ts` | tool-calling loop (L1086+) | 解析 `<tool_call>` → 执行 → 注入结果 → 循环 |
| `toolset-context.builder.ts` | `build()` | 组装工具列表 + skill 内容 + Tool Use Strategy |
| `toolset-context.builder.ts` | `stripPhaseInitializeSectionIfNeeded()` | 非 initialize 阶段裁剪 skill 的 phaseInitialize 段落 |
| `orchestration-step-dispatcher.service.ts` | `phaseInitialize()` | 调用 plannerService → 校验 outline → 成功/失败路径 |

---

## 4. Skill 激活与裁剪机制

### 4.1 当前 skill 激活逻辑

`context-strategy.service.ts` 的 `shouldActivateSkillContent()` 支持两种模式：

1. **Tag-based 门控**：skill.tags 中 `field:value:rule` 格式的激活标签（no > must > enable）
2. **旧模式**（无激活 tag 时）：基于 task.type 匹配、关键词命中等

rd-workflow 当前的 tags：`domainType:development:must`, `phase:initialize:enable`
- `domainType:development:must` → 仅 development 域激活
- `phase:initialize:enable` → initialize 阶段建议激活（非强制）

### 4.2 phaseInitialize 段落裁剪

`toolset-context.builder.ts` 的 `stripPhaseInitializeSectionIfNeeded()`：
- 当 `roleInPlan` 以 `planner` 开头且**不是** `planner_initialize` 时，裁剪 skill 中的 `## phaseInitialize` 段落
- 即：generating / pre_execute / post_execute 阶段不会看到 phaseInitialize 指令
- **但 initialize 阶段保留了 skill 全文**——这正是冲突的来源

### 4.3 冲突链路图

```
phaseInitialize 阶段
    ↓
roleInPlan = 'planner_initialize'
    ↓
stripPhaseInitializeSectionIfNeeded() → 不裁剪（保留 skill 全文）
    ↓
LLM 上下文同时包含：
  [system] rd-workflow skill 的 "## phaseInitialize 扩展步骤"（4 步具体工具序列）
  [user]   buildPhaseInitializePrompt() 的 Phase 1 + Phase 2 指令
    ↓
LLM 优先执行 skill 的 4 步 → 跳过 Phase 1 → outline 未写入 → initialize 失败
```

---

## 5. 已观察到的 LLM 行为模式

基于 2026-03-30 多轮 session（plan-69ca82258250961fad6f7b69 和 plan-69ca86582ef9f93dddaa90c6）：

| 行为 | 频率 | 影响 |
|------|------|------|
| 跳过 Phase 1（outline），直接执行 skill 的需求锚定 | 100%（6/6 轮） | outline 缺失 → hasValidOutlineWithPrompts 校验失败 → 重试 |
| 工具重复调用（requirement.list x2-3, requirement.get x2） | 100% | token 浪费 + 冗余副作用 |
| plan-initialize(taskContext) 缺失 planId | 80%（5/6 轮） | 触发参数修正重试 |
| 第二轮 existingRequirementId 被无视，重新调 requirement.list | 100%（3/3 轮） | 查到 0 条（需求已被改为 assigned）→ 卡死 |
| planId 用标题字符串代替实际 ObjectId | 30%（2/6 轮） | plan-initialize 写入错误目标 |
| list-agents 从未被调用 | 100% | outline 中无 recommendedAgent |

---

## 6. 解决方向

### 方向 A：Initialize 阶段裁剪 skill 的 phaseInitialize 扩展步骤

在 `toolset-context.builder.ts` 中，当 `roleInPlan === 'planner_initialize'` 时，也裁剪 skill 中的 `## phaseInitialize 扩展步骤` 段落。理由：`buildPhaseInitializePrompt()` 已经包含了完整的 Phase 2 指引（含 existingRequirementId 分支），skill 的扩展步骤是冗余且冲突的。

**优点**：从根源消除冲突，LLM 上下文中只有一套指令
**缺点**：需要改 `toolset-context.builder.ts`，且裁剪逻辑需要区分 "phaseInitialize 扩展步骤" 和 skill 其他内容

### 方向 B：在 prompt 中声明指令优先级

在 `buildPhaseInitializePrompt()` 中增加："本 prompt 中的 Phase 1/Phase 2 指令优先级高于 skill 中的 phaseInitialize 扩展步骤，以本 prompt 为准"。

**优点**：只改 prompt，改动最小
**缺点**：不保证 LLM 遵循优先级声明（历史经验表明文本约束对 LLM 行为的控制力有限）

### 方向 C：将 skill 的扩展步骤参数预编译到 prompt 中

在 `buildPhaseInitializePrompt()` 构建时，从 skill 内容中提取 phaseInitialize 扩展步骤，将参数（如 requirementId）预填后合并到 Phase 2 指令中，同时裁剪 skill 原文的对应段落。

**优点**：既消除冲突，又保留 skill 定义的灵活性
**缺点**：实现复杂度最高

### 当前推荐

**方向 A**，因为 `buildPhaseInitializePrompt()` 已经覆盖了 Phase 2 的完整逻辑（包括 existingRequirementId 条件分支），skill 的扩展步骤完全冗余。裁剪后 LLM 上下文中只剩一套清晰的指令序列。

---

## 7. 相关文档

| 文档 | 路径 |
|------|------|
| 问题追踪 | `docs/issue/PLAN_OPTIMAZE.md` |
| Plan 文档 | `docs/plan/PLANNER_INITIALIZE_REFACTOR_AND_SKILL_ACTIVATION_GATE.md` |
| 技术方案 | `docs/technical/PLANNER_INITIALIZE_REFACTOR_AND_SKILL_ACTIVATION_GATE_DESIGN.md` |
| Prompt & Skill 边界 | `docs/guide/PROMPT&SKILL_BOUNDARY.MD` |
| Skill 加载机制 | `docs/guide/SKILL_LOAD.md` |
