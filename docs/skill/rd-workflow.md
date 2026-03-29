---
name: rd-workflow
description: RD 需求开发流程（phaseInitialize + 3-step），由 Planner 在初始化阶段完成需求选择和任务大纲生成，再进入技术规划、开发执行与实现评估。
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
- 后续所有步骤通过系统自动注入 `plan.metadata.taskContext` 获取 requirementId / requirementTitle / requirementDescription。
- 需求状态更新时机：initialize 完成后 `assigned`，step1 pre-execute `in_progress`，step3 pre-execute `review`。

## 执行引擎约束（Planner 生成任务时必须遵守）

1. step1（技术方案）、step2（执行开发）的 taskType 必须分别设为 `development.plan`、`development.exec`
2. step3（实现评估）的 taskType 必须设为 `development.review`
3. 所有 step 的 task.description 中禁止出现以下内部工具引用关键词：
   `repo-writer`、`repo-read`、`builtin.sys-mg`、`save-template`、`save-prompt-template`
   如需描述代码操作，使用"读取代码"、"修改代码"、"提交变更"等自然语言表述。

## phaseInitialize 行为（首次启动时执行一次）

1. 调用 `list-agents` 获取可用 agent 列表。
2. development 计划调用 `requirement.list(status=todo)` 并选择最高优先级需求。
3. 调用 `requirement.get(requirementId)` 获取需求详情。
4. 输出任务大纲 `outline`（JSON 数组）。
5. 系统在 initialize 成功后将需求状态更新为 `assigned`。

## 步骤定义（严格按序执行，共 3 步）

### step1: 制定技术开发计划
- **执行角色**: 技术专家（从 list-agents 中查找能力标签包含"development_plan"及"opencode"的 agent）
- **任务类型**: development.plan
- **输入**: phaseInitialize 注入的 taskContext + 相关代码/文档
- **动作**: 基于需求规格设计实现方案，拆解开发子任务，评估技术风险
- **输出契约**: 结构化开发计划（含实现步骤、涉及文件/接口清单、测试要点）
- **约束**: taskType 设为 development.plan；输出中避免引用具体内部工具名称

### step2: 执行开发
- **执行角色**: 全栈开发（选择当前状态空闲的 "development_exec"及"opencode" agent）
- **任务类型**: development.exec
- **输入**: step1 输出的开发计划
- **动作**: 按计划实施代码变更并提交
- **输出契约**: 代码 commit 信息（含 commit hash、变更文件列表、变更摘要）
- **约束**: taskType 设为 development.exec；描述中使用"读取代码"、"修改代码"、"提交变更"等自然语言，禁止引用内部工具名称

### step3: 实现评估
- **执行角色**: 技术专家（与 step1 同一 agent）
- **任务类型**: development.review
- **输入**: step2 输出的 commit 信息 + step1 的开发计划及验收清单
- **动作**: 对照验收标准评估实现质量，给出通过/修改意见
- **输出契约**: 评估结论（通过/需修改 + 具体意见）
- **约束**: taskType 设为 development.review

## 需求状态更新规则（pre-execute 阶段执行）

状态更新时机：
1. phaseInitialize 完成后，系统更新 `assigned`
2. step1 pre-execute 更新 `in_progress`
3. step3 pre-execute 更新 `review`
