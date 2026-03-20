---
name: model-management-grounding
description: 模型管理场景的反幻觉与工具落地约束，确保“先执行工具、后声明结果”。
metadata:
  author: opencode
  version: "0.1.0"
  language: zh-CN
  applies_to:
    - model-management
  tags:
    - model-management
    - grounding
    - anti-hallucination
    - tool-verification
  required_tools:
    - builtin.sys-mg.mcp.model-admin.add-model
    - builtin.sys-mg.mcp.model-admin.list-models
  risk_level: medium
---

# Model Management Grounding

## 1. 核心约束

- 禁止在未调用工具且未收到工具结果时声称“已添加成功/已完成”。
- 所有状态声明必须可由工具结果追溯。

## 2. 标准执行序列

1. 调用 `builtin.sys-mg.mcp.model-admin.add-model` 执行写入。
2. 调用 `builtin.sys-mg.mcp.model-admin.list-models` 验证新增结果。
3. 基于验证结果给出最终答复。

## 3. 失败处理

- 任一步骤失败都要明确错误原因，不得伪造成功。
- 写入成功但验证失败时，应说明“写入状态待确认”，并建议重试验证。

## 4. 输出规范

- 先说明是否完成，再给出关键证据字段。
- 若失败，必须包含“失败原因 + 下一步建议”。
