---
name: rd-workflow
description: RD 需求开发流程（phaseInitialize + 3-step），由 Planner 在初始化阶段通过工具调用完成需求选择和任务大纲生成，再进入技术规划、开发执行与实现评估。
metadata:
  author: opencode
  version: "0.5.0"
  language: zh-CN
  applies_to:
    - requirement-planning
    - multi-agent-rd
  tags:
    - rd-workflow
    - requirement-triage
    - planning
    - multi-agent
  capabilities:
    - requirement-clarification
    - demand-classification-and-tagging
    - technical-planning
    - state-tracking
  risk_level: medium
---

# RD Requirement development 需求开发流程

## Planner 角色说明（最高优先级）

本技能定义的是**任务模板**，描述每个步骤"应该让执行者做什么"。
Planner 的职责是根据步骤定义通过 `submit-task` 提交任务卡片，不直接执行开发动作。
- 步骤定义中的"动作"描述是给执行者的指令，Planner 应转化为 task.description。
- 规划阶段禁止直接执行业务代码操作，只负责工具调用与任务生成。

## 流程原则

- **数据锚定规则（强制）**：phaseInitialize 选定的 requirementId 是本次编排的唯一锚点。
- 后续所有步骤通过系统自动注入 `plan.metadata.taskContext` 获取 requirementId / requirementTitle / requirementDescription，Planner 无需手动在 task.description 中填写锚定标记。
- 需求状态更新时机：initialize 完成后 `assigned`（系统自动），step1 pre-execute `in_progress`，step3 pre-execute `review`。

## 执行引擎约束（Planner 生成任务时必须遵守）

1. 各 step 的 taskType 必须与下方步骤定义一致（step1=development.plan, step2=development.exec, step3=development.review）。
2. 所有 step 的 task.description 中禁止出现以下内部工具引用关键词：
   `repo-writer`、`repo-read`、`builtin.sys-mg`、`save-template`、`save-prompt-template`
   如需描述代码操作，使用"读取代码"、"修改代码"、"提交变更"等自然语言表述。

## phaseInitialize 行为（首次启动时执行一次）

Planner 在初始化阶段需要在**一轮对话**内完成以下工具调用和输出。

### 工具调用序列

1. 调用 `builtin.sys-mg.internal.agent-master.list-agents` 获取可用 agent 列表（含角色、能力标签、工具、运行时状态）。
2. 调用 `builtin.sys-mg.mcp.requirement.list`（参数 `status=todo`）获取待办需求列表。
3. 从返回结果中选择优先级最高且可执行的需求。
4. 调用 `builtin.sys-mg.mcp.requirement.get`（参数 `requirementId=<选定的ID>`）获取该需求的完整详情。
5. 调用 `builtin.sys-mg.mcp.requirement.update-status`（参数 `requirementId=<选定的ID>, status=assigned, changedByType=agent, changedByName=orchestration-planner-agent, note=phaseInitialize 选定需求`）将需求状态更新为 `assigned`。

### 最终输出

完成上述工具调用后，输出以下 JSON 作为最终结果：

```json
{
  "requirementId": "<选定的需求ID>",
  "requirementTitle": "<需求标题>",
  "requirementDescription": "<需求描述原文>",
  "outline": [
    {
      "step": 1,
      "title": "制定技术开发计划",
      "taskType": "development.plan",
      "preExecuteActions": [
        { "tool": "builtin.sys-mg.mcp.requirement.update-status", "params": { "requirementId": "<选定的需求ID>", "status": "in_progress", "changedByType": "agent", "changedByName": "orchestration-planner", "note": "step1 pre_execute" } }
      ]
    },
    {
      "step": 2,
      "title": "执行开发",
      "taskType": "development.exec"
    },
    {
      "step": 3,
      "title": "实现评估",
      "taskType": "development.review",
      "preExecuteActions": [
        { "tool": "builtin.sys-mg.mcp.requirement.update-status", "params": { "requirementId": "<选定的需求ID>", "status": "review", "changedByType": "agent", "changedByName": "orchestration-planner", "note": "step3 pre_execute" } }
      ]
    }
  ],
  "reasoning": "<选择该需求的理由>"
}
```

> **注意**：`preExecuteActions` 中的参数必须使用 phaseInitialize 阶段获取的**实际值**（如真实 requirementId），禁止使用 `{{...}}` 占位符。系统会在 pre_execute 阶段直接将这些动作注入 Planner prompt。

### 失败处理

- 如果 `requirement.list` 返回空列表（无待办需求），输出 `{"requirementId": null, "outline": [], "reasoning": "需求池为空，无可执行需求"}` — 系统将终止计划。
- 如果工具调用失败，仍尽可能输出 outline 以确保后续流程可降级。

### 系统行为（Planner 无需操作）

- 系统将 requirementId / requirementTitle / requirementDescription 写入 `plan.metadata.taskContext`，后续 step 自动注入。

## 步骤定义（严格按序执行，共 3 步）

### step1: 制定技术开发计划
- **taskType**: `development.plan`
- **Agent Executor Role**: 技术专家（从 list-agents 中查找能力标签包含 `development_plan` 及 `opencode` 的 agent）
- **Input**: phaseInitialize 注入的 taskContext（含需求详情）+ 相关代码/文档
- **Output Contract**: 结构化开发计划（含实现步骤、涉及文件/接口清单、测试要点）
- **Constraints**: 输出中避免引用具体内部工具名称
- **Four-Phase Behavior**:
  - **generate**: 生成任务描述，引用 taskContext 中的 requirementId 和需求标题，明确要求执行者输出结构化开发计划
  - **pre_execute**:
    1. **必须执行**: 调用 `builtin.sys-mg.mcp.requirement.update-status`，参数: `requirementId={{taskContext.requirementId}}, status=in_progress, changedByType=agent, changedByName=orchestration-planner, note=step1 pre_execute`
    2. 检查执行者工具匹配度
  - **execute**: 执行者分析需求规格，设计实现方案，拆解开发子任务，评估技术风险
  - **post_execute**: 验证输出包含完整开发计划（实现步骤 + 涉及文件 + 测试要点），决定 `generate_next`

### step2: 执行开发
- **taskType**: `development.exec`
- **Agent Executor Role**: 全栈开发（选择当前状态空闲的具备 `development_exec` 及 `opencode` 能力的 agent）
- **Input**: step1 输出的开发计划
- **Output Contract**: 代码 commit 信息（含 commit hash、变更文件列表、变更摘要）
- **Constraints**: 描述中使用"读取代码"、"修改代码"、"提交变更"等自然语言，禁止引用内部工具名称
- **Four-Phase Behavior**:
  - **generate**: 生成任务描述，引用 step1 的开发计划作为执行依据
  - **pre_execute**: 检查 step1 输出可用（开发计划存在且有效）
  - **execute**: 按计划实施代码变更并提交
  - **post_execute**: 验证输出包含 commit 信息，决定 `generate_next`

### step3: 实现评估
- **taskType**: `development.review`
- **Agent Executor Role**: 技术专家（与 step1 同一 agent）
- **Input**: step2 输出的 commit 信息 + step1 的开发计划及验收清单
- **Output Contract**: 评估结论（通过/需修改 + 具体意见）
- **Constraints**: taskType 设为 `development.review`
- **Four-Phase Behavior**:
  - **generate**: 生成评审任务描述，要求执行者对照验收标准逐项评估
  - **pre_execute**:
    1. **必须执行**: 调用 `builtin.sys-mg.mcp.requirement.update-status`，参数: `requirementId={{taskContext.requirementId}}, status=review, changedByType=agent, changedByName=orchestration-planner, note=step3 pre_execute`
  - **execute**: 对照验收标准评估实现质量，给出通过/修改意见
  - **post_execute**: 验证评审结论完整（包含逐项评估 + 最终结论），决定 `stop`

## 需求状态更新规则

| 时机 | 状态 | 触发方 | 工具 |
|------|------|--------|------|
| phaseInitialize 完成 | `assigned` | Planner 工具调用 | `builtin.sys-mg.mcp.requirement.update-status` |
| step1 pre-execute | `in_progress` | Planner 工具调用 | `builtin.sys-mg.mcp.requirement.update-status` |
| step3 pre-execute | `review` | Planner 工具调用 | `builtin.sys-mg.mcp.requirement.update-status` |
