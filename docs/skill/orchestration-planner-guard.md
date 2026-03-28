---
name: orchestration-planner-guard
description: Guardrails for orchestration planning with default multi-agent assignment, optional planner-lock mode, capability checks, and auditable outputs.
metadata:
  author: opencode
  version: "1.1.0"
  language: en
  applies_to:
    - orchestration
    - cto-triage
    - multi-agent-planning
  tags:
    - orchestration
    - planning
    - assignment-guard
    - capability-check
    - auditable-output
  capabilities:
    - role-based-assignment
    - capability-and-permission-check
    - planner-lock-policy
    - structured-audit-output
  risk_level: medium
---

# Orchestration Planner Guard

Use this skill when an agent needs to create orchestration plans from requirement backlogs and assign work to other agents.

## 1) Design Intent

- Keep planning behavior aligned with system design: **default is multi-agent assignment**.
- Enforce stricter assignment only when policy explicitly requests it.
- Prevent invalid assignment by requiring capability and permission checks before delegation.
- Produce deterministic and auditable outputs via tool calls (`submit-task` / `report-task-run-result`).

## 2) Assignment Policy Model

### 2.1 Default Policy (standard)

- Use role-based multi-agent assignment.
- Different tasks can be assigned to different target agents.
- Typical mapping:
  - `development -> fullstack_developer`
  - `code_review -> technical_expert` (optional)

### 2.2 Locked Policy (explicit only)

Enable planner-lock checks only if any of the following is present:

- `assignmentPolicy=lock_to_planner`
- `enforceSingleAssignee=true`
- explicit user instruction like: `all tasks assigned to me`

When locked policy is enabled:

- every `task.assignee` must equal `planner.agentId`
- otherwise reject plan with:
  - `assignee_must_be_planner`

## 3) Mandatory Capability Checks (always required)

Before assigning any task to a `targetAgent`, validate:

- available tools
- tool call permissions
- required capabilities for the task type

If validation fails:

- do not assign that task
- mark task as `not_applicable`
- set reason to `capability_missing` or `permission_denied`

## 4) Prompt Contract

For development tasks sent to `fullstack_developer` in requirement-triage flows:

- prompt must contain only raw requirement information
- do not append decomposition, implementation guidance, acceptance criteria, or extra context

## 5) Workflow

1. List requirements and filter `status=TODO`.
2. If none, return `noTodoDemands=true` and stop.
3. Resolve candidate agents by role.
4. Run capability and permission checks.
5. Create one independent orchestration plan per TODO requirement.
6. Assign tasks according to policy (default multi-agent, optional lock).
7. Send notifications to assigned target agents.
8. Submit tasks via `builtin.sys-mg.mcp.orchestration.submit-task` tool and return assignment results.

## 6) Validation Checklist

- [ ] Assignment policy detected correctly (default vs locked).
- [ ] Capability checks executed before assignment.
- [ ] Development prompt uses raw requirement only (when required by flow).
- [ ] Code review assigned only to `technical_expert`.
- [ ] One requirement maps to one independent plan.
- [ ] Output includes failures, fallback path, and notification status.

## 7) Reject Conditions

- `assignee_must_be_planner`
  - only when locked policy is enabled and any task violates assignee rule
- `capability_check_required`
  - assignment attempted before capability validation
- `fullstack_prompt_must_be_raw_requirement`
  - development prompt includes non-raw content where raw-only contract applies
- `code_review_role_violation`
  - code review assigned to a non-technical-expert role

## 8) Tool-Driven Output

Planner outputs are now submitted via tool calls rather than direct JSON text:

- **Task creation**: call `builtin.sys-mg.mcp.orchestration.submit-task` with `planId`, `action`, `title`, `description`, `taskType`, `agentId`, etc.
- **Post-execution decision**: call `builtin.sys-mg.mcp.orchestration.report-task-run-result` with `planId`, `action`, `reason`, etc.
- **Goal reached**: call `submit-task` with `isGoalReached=true`.

Tool parameter schemas enforce `required` fields, `enum` constraints, and `additionalProperties: false`, providing API-level validation that replaces free-form JSON generation.

## 9) Notes

- This skill defines planning behavior only.
- If platform-level hard enforcement is needed, add backend validation in create/update plan APIs.
