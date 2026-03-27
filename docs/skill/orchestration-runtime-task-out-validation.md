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
---

# Orchestration Runtime Task Output Validation

用于 `phasePostExecute` 的任务输出验收与下一步决策规则。

## 1) 硬约束

- 仅输出一个合法 JSON 对象。
- 禁止输出自然语言、markdown fence、解释文本。
- 必须返回 `validation.passed`、`validation.verdict`、`validation.ruleVersion`。

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

## 4) 输出结构

```json
{
  "nextAction": "generate_next|stop|redesign|retry",
  "reason": "...",
  "redesignTaskId": "...",
  "nextTaskHints": ["..."],
  "validation": {
    "passed": true,
    "verdict": "pass|needs_fix|blocked",
    "missing": ["..."],
    "ruleVersion": "post_execute_skill_v1"
  }
}
```
