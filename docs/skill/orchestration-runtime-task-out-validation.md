---
name: orchestration-runtime-task-out-validation
description: Output validation rules for orchestration planner phasePostExecute.
metadata:
  author: opencode
  version: "1.0.0"
  language: zh-CN
  applies_to:
    - orchestration
    - planner-post-execute
  tags:
    - orchestration
    - post-execute
    - roleInPlan:planner,planner_post_execution:must
    - phase:post_execute:must
---

# Orchestration Runtime Task Output Validation

用于 `phasePostExecute` 的任务输出验收与下一步决策规则。

## 1) 硬约束

- 必须通过调用工具 `builtin.sys-mg.mcp.orchestration.report-task-run-result` 报告决策结果。
- 禁止直接输出纯文本 JSON 作为最终结果。
- 工具参数中 `action` 和 `reason` 为必填项。

## 2) 全局规则

- 若 `executionStatus=failed`，优先 `redesign`；仅在明确可重试时允许 `retry`。
- 若输出出现能力不足信号（如 `TASK_INABILITY`、`missing tool`、`cannot browse`、`无法执行`、`缺少工具`），`validation.passed=false`。
- 若 `executionStatus=completed` 且证据充分，可 `generate_next`。

## 3) 按 runtimeTaskType 的验收规则

### `research`

- 需要可核验来源证据（URL、检索/抓取痕迹、结构化 findings/cities）。
- 仅有泛化结论且无来源证据时，校验失败。

### `development.plan` / `development.exec`

- 需要执行证据：命令、结果、变更证明或明确失败原因。
- 仅声明“已完成”但无证据时，校验失败。

### `development.review`

- 需要 review verdict（pass/needs-fix）、证据列表、最小修复建议。
- 无代码行为或文件路径证据时，校验失败。

### `general`

- 输出应为可执行结果，不接受纯建议式内容作为完成结果。

## 4) 工具调用参数

调用 `builtin.sys-mg.mcp.orchestration.report-task-run-result`，参数如下：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `planId` | string | 是 | 计划 ID |
| `action` | string | 是 | `generate_next` / `stop` / `redesign` / `retry` |
| `reason` | string | 是 | 决策原因（包含验收判定依据） |
| `redesignTaskId` | string | action=redesign 时必填 | 目标 task ID |
| `nextTaskHints` | string[] | 否 | 下一步任务提示 |

在 `reason` 中应体现验收结论（如：校验通过、缺少证据、能力不足等），供审计追溯。
