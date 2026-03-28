---
name: rd-workflow
description: CTO 主导的 RD 需求开发流程，涵盖需求选定、范围确认、技术规划、开发执行和实现评估五个步骤，确保高质量的需求实现闭环。
metadata:
  author: opencode
  version: "0.4.0"
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
Planner 的职责是**根据步骤定义通过 `submit-task` 工具提交任务卡片**，而非自己执行步骤中的动作。
- 步骤定义中的"动作"描述是给**执行者**的指令，Planner 应将其转化为 task.description。
- Planner 在规划阶段**禁止调用任何业务工具**（如需求查询、代码读写等），只需调用 `submit-task` 提交任务。
- 需求状态更新由 Planner 在 **pre-execute 阶段**（执行前评估）通过工具调用完成，不在规划阶段调用。

## 流程原则

- **数据锚定规则（强制）**：step1 选定的 requirementId 是本次编排的唯一锚点。后续所有 step 的 task.description 必须在开头显式引用该 requirementId 和标题原文，禁止替换为其他需求。

## 执行引擎约束（Planner 生成任务时必须遵守）

1. step3（技术方案）、step4（执行开发）的 taskType 必须分别设为 `development.plan`、`development.exec`
2. step5（实现评估）的 taskType 必须设为 `development.review`
3. 所有 step 的 task.description 中，禁止出现以下内部工具引用关键词：
   `repo-writer`、`repo-read`、`builtin.sys-mg`、`save-template`、`save-prompt-template`
   如需描述代码操作，使用"读取代码"、"修改代码"、"提交变更"等自然语言表述

## 步骤定义（严格按序执行，共 5 步）

### step1: 选定最高优先级需求
- **执行角色**: Kim-CTO（从 list-agents 中查找 role 包含 executive-lead 的 agent）
- **任务类型**: general
- **输入**: 当前 EI 需求池
- **动作**: 使用需求管理工具（如需求看板或需求列表查询）主动获取当前所有需求，从中筛选状态为 todo/open 的条目，选择优先级最高且可执行的一项，再获取该需求的完整详情。本步骤无需依赖上游输入，执行者应直接查询需求池。
- **输出契约（必须包含，缺一不可）**:
  1. requirementId（需求唯一标识）
  2. 标题原文
  3. **需求描述原文（description 字段的完整内容，禁止省略或改写）**
  4. 选择依据（1-2 条）
- **下游绑定**: 后续所有 step 在 task.description 开头必须注明 `【锚定需求】requirementId=<step1输出的ID>, 标题=<step1输出的标题>`

### step2: 确认需求范围
- **执行角色**: 与 step1 同一 agent（Kim-CTO）
- **任务类型**: general
- **输入**: step1 输出的 requirementId + 标题 + **需求描述原文**
- **动作**: 以需求描述原文为唯一事实来源，直接复述需求描述原文
- **输出契约**: 必须包含需求描述原文
- **约束**: 禁止改变 requirementId；禁止将需求替换为其他条目

### step3: 制定技术开发计划
- **执行角色**: 技术专家（从 list-agents 中查找能力标签包含"development_plan"及"opencode"的 agent）
- **任务类型**: development.plan
- **输入**: 读取需求详情和相关代码/文档；明确业务边界、验收标准、最小变更范围
- **动作**: 基于需求规格设计实现方案，拆解开发子任务，评估技术风险
- **输出契约**: 结构化开发计划（含实现步骤、涉及文件/接口清单、测试要点）
- **约束**: taskType 设为 development.plan；输出中避免引用具体内部工具名称

### step4: 执行开发
- **执行角色**: 全栈开发（选择当前状态空闲的 "development_exec"及"opencode" agent）
- **任务类型**: development.exec
- **输入**: step3 输出的开发计划
- **动作**: 按计划实施代码变更并提交
- **输出契约**: 代码 commit 信息（含 commit hash、变更文件列表、变更摘要）
- **约束**: taskType 设为 development.exec；描述中使用"读取代码"、"修改代码"、"提交变更"等自然语言，禁止引用内部工具名称

### step5: 实现评估
- **执行角色**: 技术专家（与 step3 同一 agent）
- **任务类型**: development.review
- **输入**: step4 输出的 commit 信息 + step3 的开发计划及验收清单
- **动作**: 对照验收标准评估实现质量，给出通过/修改意见
- **输出契约**: 评估结论（通过/需修改 + 具体意见）
- **约束**: taskType 设为 development.review

## 需求状态更新规则（pre-execute 阶段执行）

以下规则仅在 Planner 执行 **pre-execute 决策**（执行前评估）时生效，Planner 应在返回 `allowExecute` JSON 之前通过工具完成需求状态回写。

状态更新时机：
1. step1 任务进入 pre-execute 时，将需求状态更新为 `assigned`
2. step2/step3 任务进入 pre-execute 时，将需求状态更新为 `in_progress`
3. step5 任务进入 pre-execute 时，将需求状态更新为 `review`

调用参数：
- requirementId: 从 plan.metadata 或已完成任务输出中获取
- status: assigned | in_progress | review
- changedByType: agent
- changedByName: orchestration-planner-agent
- note: 描述当前步骤信息
