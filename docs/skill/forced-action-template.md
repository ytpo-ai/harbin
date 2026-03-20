---
name: forced-action-template
description: Before-Step Hook 强制工具调用模板，按运行时透传 tool 与 parameters 渲染。
metadata:
  author: opencode
  version: "0.1.0"
  language: zh-CN
  applies_to:
    - agent-runtime
  tags:
    - forced-tool-call
    - forced-action-template
  risk_level: medium
---

# Forced Action Template

当系统判定存在明确执行意图时，使用以下模板直接驱动工具调用：

执行前优化建议：你已确认用户存在明确意图。请立即调用 <tool_call>{"tool":"{{tool}}","parameters":{{parameters}}}</tool_call> 并等待工具结果后再回复。

约束：

- 不要追加解释性前缀或后缀。
- 必须等待工具结果后再给最终回复。
- 若工具失败，遵循 `agent-runtime-baseline` 的降级策略。
