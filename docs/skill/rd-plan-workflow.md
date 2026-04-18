---
name: rd-plan-workflow
description: RD Plan 驱动开发流程（phaseInitialize + 2-step 循环），以 plan 文档为起点，提取 requirement 入库 EI 系统，然后逐个 requirement 执行开发与评审。
metadata:
  author: opencode
  version: "0.1.0"
  language: zh-CN
  applies_to:
    - plan-driven-development
    - multi-agent-rd
  tags:
    - rd-plan-workflow
    - multi-agent
    - domainType:development:must
    - phase:initialize:must
  capabilities:
    - plan-document-parsing
    - requirement-extraction-and-creation
    - development-execution
    - implementation-review
    - state-tracking
  risk_level: medium
---

# RD Plan-Driven Development 需求开发流程

## Planner 角色说明（最高优先级）

本技能定义的是**任务模板**，描述每个步骤"应该让执行者做什么"。
Planner 的职责是根据步骤定义通过 `submit-task` 提交任务卡片，不直接执行开发动作。
- 步骤定义中的"动作"描述是给执行者的指令，Planner 应转化为 task.description。
- 规划阶段禁止直接执行业务代码操作，只负责工具调用与任务生成。

## 与 rd-workflow 的区别

| 维度 | rd-workflow | rd-plan-workflow（本 skill） |
|------|-------------|------------------------------|
| 输入源 | EI 系统中已有 requirement | 外部指定 plan 文档路径 |
| 需求来源 | 已入库 | 从 plan 文档 §5 提取后入库 |
| 开发步骤 | 3 步（plan→exec→review） | 2 步（exec→review），plan 文档即开发计划 |
| 循环粒度 | 单个 requirement | 多个 requirement 串行循环 |

## 流程原则

- **文档驱动规则（强制）**：plan 文档是本次编排的唯一输入源。plan 文档必须严格遵循 `docs/plan/TEMPLATE.md` 格式，特别是 §5 Requirement 拆解表格。
- **数据锚定规则（强制）**：phaseInitialize 从 plan 文档提取的 requirement 列表是本次编排的锚点。当前正在开发的 requirement 通过 `taskContext.currentRequirementIndex` 标识。
- 后续所有步骤通过系统自动注入 `plan.metadata.taskContext` 获取 requirementId / requirementTitle / requirementDescription 及 plan 文档上下文。
- 需求状态更新时机：入库后 `todo`，首个 requirement 分配后 `assigned`，step1 pre-execute `in_progress`，step2 pre-execute `review`，step2 post_execute 通过后 `done`。

## 执行引擎约束（Planner 生成任务时必须遵守）

1. 各 step 的 taskType 必须与下方步骤定义一致（step1=development.exec, step2=development.review）。
2. 所有 step 的 task.description 中禁止出现以下内部工具引用关键词：
   `repo-writer`、`repo-read`、`builtin.sys-mg`、`save-template`、`save-prompt-template`
   如需描述代码操作，使用"读取代码"、"修改代码"、"提交变更"等自然语言表述。

## phaseInitialize 扩展步骤

> 说明：outline 与 phasePrompts 由初始化核心指令统一生成并通过 `plan-initialize(mode=outline)` 写入。
> 本节仅定义 Plan 驱动开发领域的扩展步骤（plan 文档读取 → requirement 提取入库 → taskContext 写入）。

### 前置条件

- sourcePrompt 中必须包含 plan 文档的仓库相对路径（如 `docs/plan/XXX_PLAN.md`）。
- plan 文档必须包含 `## 5. Requirement 拆解` 段落，且表格至少有 1 行有效 requirement。

### 步骤序列

1. **读取 plan 文档**：调用 `builtin.engineering.internal.fs.repo_read`（参数 `command="cat <plan文档路径>"`），从 sourcePrompt 中提取文档路径。

2. **解析 plan 文档**：从 plan 文档内容中提取以下信息：
   - §1 基本信息：**优先级**（low/medium/high/critical）、**所属项目**（projectId）
   - §2 背景、§3 目标、§4 执行步骤：作为 requirement 的上下文补充
   - §5 Requirement 拆解表格：解析每行的编号（REQ-NNN）、需求简述、状态

3. **逐条创建 requirement 入库**：对每个解析出的 requirement，调用 `builtin.engineering.mcp.requirement.create`，记录返回的 requirementId。

   **字段继承与默认值规则**：

   | requirement 字段 | 值来源 | 默认值 |
   |---|---|---|
   | `title` | §5 表格中的 `REQ-NNN: 需求简述` | 必填 |
   | `description` | §2/§3/§4 中与该 requirement 相关的上下文 + §5 的具体描述 | 必填 |
   | `priority` | **继承 plan 文档 §1 的优先级** | `medium` |
   | `category` | 根据 plan 性质推断：新功能→`feature`，修复→`fix`，优化→`optimize` | `feature` |
   | `complexity` | 根据 §4 执行步骤数和影响范围推断 | `low` |
   | `labels` | 固定包含 `plan:<PLAN_FILE_NAME>` 和 `req:<REQ-NNN>` | 必填 |
   | `projectId` | **继承 plan 文档 §1 的所属项目** | 可选 |
   | `createdByType` | 固定值 | `agent` |

   步骤 3 的 `requirement.create` 参数（每个 requirement 调用一次）：
   ```json
   {
     "title": "<REQ-NNN: 需求简述>",
     "description": "<从 plan 文档 §2/§3/§4 中提取的相关上下文 + 该 requirement 的具体描述>",
     "priority": "<继承 plan §1 优先级，缺省 medium>",
     "category": "<根据 plan 性质推断，缺省 feature>",
     "complexity": "<根据影响范围推断，缺省 low>",
     "labels": ["plan:<PLAN_FILE_NAME>", "req:<REQ-NNN>"],
     "projectId": "<继承 plan §1 所属项目，缺省不传>",
     "createdByType": "agent"
   }
   ```

4. **逐条同步 requirement 到 GitHub Issue**：每个 requirement 入库成功后，立即调用 `builtin.engineering.mcp.requirement.sync-github` 将其同步为 GitHub Issue。

   步骤 4 的 `requirement.sync-github` 参数（每个 requirement 调用一次）：
   ```json
   {
     "requirementId": "<入库返回的ID>"
   }
   ```
   > 说明：`owner` 和 `repo` 参数可省略，由系统从项目配置中自动获取。如需指定可显式传入。

5. **写入 taskContext**：调用 `builtin.sys-mg.mcp.orchestration.plan-initialize` 将 plan 文档内容和 requirement 列表写入共享上下文。

   步骤 5 的 `plan-initialize` 参数：
   ```json
   {
     "mode": "taskContext",
     "data": {
       "planDocPath": "<plan文档仓库相对路径>",
       "planDocContent": "<plan文档全文（§1~§8）>",
       "requirements": [
         {
           "requirementId": "<入库返回的ID>",
           "reqCode": "REQ-001",
           "title": "<需求简述>",
           "description": "<需求描述>",
           "status": "todo"
         }
       ],
       "totalRequirements": "<requirement总数>",
       "currentRequirementIndex": 0,
       "requirementId": "<首个requirement的ID>",
       "requirementTitle": "<首个requirement的标题>",
       "requirementDescription": "<首个requirement的描述>"
     }
   }
   ```

6. **设置首个 requirement 状态为 assigned**：调用 `builtin.engineering.mcp.requirement.update-status`。

   步骤 6 的 `requirement.update-status` 参数（**必须包含以下字段**）：
   ```json
   {
     "requirementId": "<首个requirement的ID>",
     "status": "assigned",
     "toAgentId": "<Planner Agent 自身的 agentId>",
     "toAgentName": "<Planner Agent 自身的名称>",
     "note": "需求已从 plan 文档提取并入库，分配至计划编排"
   }
   ```

> 说明：`planId` 会由系统从编排上下文自动注入，无需手动传入。

## 步骤定义（2 步循环，按 requirement 粒度串行）

### step1: 执行开发
- **taskType**: `development.exec`
- **Agent Executor Role**: 全栈开发（选择当前状态空闲的具备 `development_exec` 及 `opencode` 能力的 agent）
- **Input**: taskContext 中的 plan 文档内容（作为开发计划）+ 当前 requirement 的描述和验收条件
- **Output Contract**: 代码 commit 信息（含 commit hash、变更文件列表、变更摘要）
- **Constraints**: 描述中使用"读取代码"、"修改代码"、"提交变更"等自然语言，禁止引用内部工具名称
- **Four-Phase Behavior**:
  - **generate**: 生成任务描述，引用 taskContext 中的 plan 文档内容和当前 requirement（requirementId + 标题 + 描述），明确要求执行者按 plan 文档的执行步骤实施当前 requirement 的代码变更
  - **pre_execute**:
    1. **必须执行**: preExecuteActions（将当前 requirement 状态更新为 `in_progress`）
  - **execute**: 按 plan 文档的执行步骤和当前 requirement 的描述实施代码变更并提交
  - **post_execute**: 验证输出包含 commit 信息（commit hash + 变更文件列表 + 变更摘要），决定 `generate_next`

### step2: 实现评估
- **taskType**: `development.review`
- **Agent Executor Role**: 技术专家（从 list-agents 中查找能力标签包含 `development_plan` 及 `opencode` 的 agent）
- **Input**: step1 的 commit 信息 + 当前 requirement 的验收条件（从 taskContext 获取）
- **Output Contract**: 评估结论（通过/需修改 + 具体意见）
- **Constraints**: taskType 设为 `development.review`
- **Four-Phase Behavior**:
  - **generate**: 生成评审任务描述，要求执行者对照当前 requirement 的验收标准逐项评估
  - **pre_execute**:
    1. **必须执行**: preExecuteActions（将当前 requirement 状态更新为 `review`）
  - **execute**: 对照验收标准评估实现质量，给出通过/修改意见
  - **post_execute**: 评审结论完整后，执行 **requirement 循环判断**（见下方循环机制）

## Requirement 循环机制（step2 post_execute）

step2 的 post_execute 阶段，Planner 必须执行以下判断逻辑：

1. **检查评审结论**：如果评审结果为"需修改"，决定 `retry`（重新执行 step1）。

2. **当前 requirement 通过后**：
   a. 调用 `builtin.engineering.mcp.requirement.update-status` 将当前 requirement 状态更新为 `done`。
   b. 检查 `taskContext.currentRequirementIndex + 1` 是否小于 `taskContext.totalRequirements`。

3. **还有未完成的 requirement**：
   a. 更新 `taskContext`：递增 `currentRequirementIndex`，更新 `requirementId`/`requirementTitle`/`requirementDescription` 为下一个 requirement 的信息。
      调用 `builtin.sys-mg.mcp.orchestration.plan-initialize`：
      ```json
      {
        "mode": "taskContext",
        "data": {
          "currentRequirementIndex": "<新索引>",
          "requirementId": "<下一个requirement的ID>",
          "requirementTitle": "<下一个requirement的标题>",
          "requirementDescription": "<下一个requirement的描述>"
        }
      }
      ```
   b. 调用 `builtin.engineering.mcp.requirement.update-status` 将下一个 requirement 状态更新为 `assigned`。
   c. 决定 `generate_next`，回到 step1 开始下一个 requirement 的开发。

4. **所有 requirement 已完成**：决定 `stop`，结束编排。

## 需求状态更新规则

| 时机 | 状态 | 触发方 | 工具 | 必传上下文字段 |
|------|------|--------|------|--------------|
| phaseInitialize 入库 | `todo` | requirement.create 默认 | `requirement.create` | - |
| phaseInitialize 同步 GitHub | - | Planner 工具调用 | `requirement.sync-github` | `requirementId` |
| phaseInitialize 首个分配 | `assigned` | Planner 工具调用 | `requirement.update-status` | `toAgentId`(CTO agentId), `toAgentName`(CTO name) |
| step1 pre-execute | `in_progress` | Planner 工具调用 | `requirement.update-status` | `taskType`=development.exec |
| step2 pre-execute | `review` | Planner 工具调用 | `requirement.update-status` | `taskType`=development.review |
| step2 post_execute 通过 | `done` | Planner 工具调用 | `requirement.update-status` | - |
| 切换下一个 requirement | `assigned` | Planner 工具调用 | `requirement.update-status` | `toAgentId`(CTO agentId), `toAgentName`(CTO name) |

> 所有 `requirement.update-status` 调用中，`planId` 由系统自动从 `collaborationContext.planId` 注入，无需 Planner 手动传入。

## Outline 生成规则

phaseInitialize Phase 1 生成 outline 时，固定生成 **2 个步骤**：

```json
[
  {
    "step": 1,
    "title": "执行开发",
    "taskType": "development.exec",
    "recommendedAgent": { "agentId": "<具备 development_exec + opencode 能力的 agent>", "agentName": "...", "reason": "..." },
    "phasePrompts": {
      "generating": "根据 plan 文档的执行步骤和当前 requirement 描述，生成开发执行任务",
      "execute": "按 plan 文档的设计方案实现当前 requirement，完成代码变更并提交",
      "post_execute": "验证 commit 信息完整性，确认变更文件列表和摘要"
    },
    "preExecuteActions": [
      { "tool": "builtin.engineering.mcp.requirement.update-status", "params": { "status": "in_progress", "taskType": "development.exec" } }
    ]
  },
  {
    "step": 2,
    "title": "实现评估",
    "taskType": "development.review",
    "recommendedAgent": { "agentId": "<具备 development_plan + opencode 能力的 agent>", "agentName": "...", "reason": "..." },
    "phasePrompts": {
      "generating": "生成评审任务，要求对照当前 requirement 验收条件逐项评估",
      "execute": "对照验收标准评估实现质量，给出逐项评估和最终结论",
      "post_execute": "验证评审结论完整，执行 requirement 循环判断：通过则切换下一个或结束"
    },
    "preExecuteActions": [
      { "tool": "builtin.engineering.mcp.requirement.update-status", "params": { "status": "review", "taskType": "development.review" } }
    ]
  }
]
```

> 多 requirement 的循环通过 step2 post_execute 的 `generate_next` 决策实现，不需要在 outline 中为每个 requirement 重复生成步骤。
