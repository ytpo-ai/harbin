---
name: cto-rd-workflow
description: 在 CTO 识别到需要处理开发需求时触发，执行轻量研发流程（核心版）：理解、分类、方案、开发、验收、发布。
metadata:
  author: opencode
  version: "0.2.0"
  language: zh-CN
  applies_to:
    - cto-demand-triage
    - requirement-planning
    - multi-agent-rd
  capabilities:
    - requirement-clarification
    - demand-classification-and-tagging
    - technical-planning
    - state-tracking
    - human-escalation
  risk_level: medium
---

# CTO 研发流程 Skill（核心版）

当 CTO 识别到当前事项是研发需求（而非纯咨询）时，触发本 skill。

适用：`feature` / `fix` / `doc`。

不包含：独立需求受理流程（`step0`）。

## 1. 流程原则

- 保持轻量可执行，优先跑通。
- `step1`、`step2` 由 CTO 主导完成。
- `step3` 完成前，不分配开发 agent。
- `step3` 必须包含复杂度预估。
- `step3` 如落盘文档，必须列出路径。
- `step4` 必须基于 `step3` 输出执行。
- `step5` 采用轻量验收，人类兜底。

## 2. 标准流程

### Step1 理解需求（CTO）

最少输出：需求目标、影响范围、已知信息、不确定项、暂定假设。

### Step2 分类与打标（CTO）

- 必选输出：`type=feature|fix|doc`
- 可选输出：`level(L1/L2/L3)`、模块、风险、优先级等标签

### Step3 形成方案和计划（技术专家）

必选输出：方案概述、任务拆解、复杂度预估、验收思路、文档落盘清单（如有）。

### Step4 执行开发与补充文档（全栈开发）

CTO 基于 `step3` 输出和 agent 能力分配任务，开发按方案落地并补充文档。

### Step5 验收（技术专家或人）

轻量检查：编译/构建、测试（可行范围）、代码与文档一致性、与 `step3` 目标一致性。

- 通过：进入待发布
- 不通过：明确问题并退回 `step4`

### Step6 发布（运维工程师）

由具备权限的运维执行发布。

## 3. 状态流转

建议状态：

- `analyzing`
- `pending-meeting`
- `planning`
- `ready-for-dev`
- `in-dev`
- `validating`
- `changes-requested`
- `ready-for-release`
- `done`
- `cancelled`

主流转：

- `analyzing -> planning`
- `analyzing -> pending-meeting -> analyzing`
- `planning -> ready-for-dev -> in-dev -> validating`
- `validating -> ready-for-release -> done`
- `validating -> changes-requested -> in-dev`

约束：未到 `ready-for-dev` 前，不得指定开发 agent。

## 4. 基础人类介入触发条件

- `step1/step2`：目标或边界不清，且会影响方案方向
- `step3`：多方案成本/风险差异明显，需要拍板
- `step4`：方案信息不足导致无法继续，或多 agent 职责冲突
- `step5`：验收结果存在争议，无法自动判断是否通过
- `step6`：发布需要人工权限/窗口/风险确认

## 5. Step | 角色 | 分配理由表

| Step | 角色 | 分配理由 |
|---|---|---|
| Step1 理解需求 | CTO | CTO 对项目上下文、历史需求和边界更熟，适合先做理解与澄清。 |
| Step2 分类与打标 | CTO | 分类口径需要全局一致，CTO 更适合统一标签标准。 |
| Step3 形成方案和计划 | 技术专家 | 需要较强抽象与技术取舍能力，适合由模型能力更强的技术专家承担。 |
| Step4 执行开发与补充文档 | 全栈开发 | 可按任务拆分给多个开发 agent，由 CTO 基于能力特点分配。 |
| Step5 验收 | 技术专家 或 人 | 需要综合判断代码、测试、文档与方案一致性，人类作为争议兜底。 |
| Step6 执行发布 | 运维工程师 | 发布属于权限动作，应由具备环境权限和发布职责的角色执行。 |

## 6. 使用约束

- 不因细节未满分阻塞全流程。
- 不在 `step3` 前提前派发开发任务。
- 不把可自行判断的问题过早升级为会议。
- 不在 `step5` 过度加重门禁。

## 7. 附录引用

详细补充见：`docs/skill/cto-rd-workflow-appendix.md`

附录包含：

- 触发词与触发判定规则
- 各 step 建议输出模板
- pending-meeting 会议模板
