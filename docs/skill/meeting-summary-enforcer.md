---
name: meeting-summary-enforcer
description: Enforce mandatory tool-calling workflow for `meeting.ended` events to generate and persist meeting summaries.
metadata:
  author: opencode
  version: "1.0.0"
  language: zh-CN
  applies_to:
    - inner-message-runtime-bridge
    - meeting-chat
    - meeting-ended-event
  tags:
    - meeting
    - meeting-summary
    - meeting-ended
    - mandatory-tool-call
    - idempotency
  capabilities:
    - meeting-summary-generation
    - mandatory-tool-invocation
    - idempotent-persistence
    - already-generated-handling
  required_tools:
    - builtin.sys-mg.mcp.meeting.get-detail
    - builtin.sys-mg.mcp.meeting.save-summary
  trigger_event:
    - meeting.ended
  risk_level: medium
---

# Meeting Ended Summary Enforcer

用于 `meeting.ended` 事件的强约束执行技能。该技能要求 Agent 必须完成“读取会议详情 -> 生成总结 -> 落库”的闭环，禁止仅文本回复。

## 1. 强制动作（必须按顺序执行）

A) 必须先调用 `builtin.sys-mg.mcp.meeting.get-detail` 获取会议信息与完整消息。

B) 必须基于会议详情生成以下结构化结果：
- `summary`
- `actionItems`
- `decisions`

C) 必须调用 `builtin.sys-mg.mcp.meeting.save-summary` 落库，且参数必须包含 `overwrite=false`。

D) 若保存返回 `already_generated`，必须回执：`会议总结已存在，无需重复写入`。

E) 禁止只回复文本而不调用保存工具。

## 2. 执行工作流

1. 识别当前事件为 `meeting.ended`。
2. 调用 `meeting.get-detail`，读取会议元信息与完整消息。
3. 基于详情提炼 `summary/actionItems/decisions`。
4. 调用 `meeting.save-summary(overwrite=false)` 持久化。
5. 根据工具返回给出结果回执（成功 / already_generated / 失败）。

## 3. 失败与兜底规则

- 若缺少关键入参（如 `meetingId`），先回执缺失字段并请求补充。
- 若 `get-detail` 失败，不得伪造总结；应回执失败原因并提示重试。
- 若 `save-summary` 失败，回执失败原因与建议下一步（重试或排查权限/参数）。

## 4. 输出约束

- 优先完成工具调用，再输出文本结论。
- 输出内容应与工具结果一致，不得声称“已保存”但实际未调用保存工具。
- `already_generated` 场景必须使用固定回执文案，避免歧义。
