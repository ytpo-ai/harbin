---
name: agent-runtime-baseline
description: Agent 运行时通用行为基线，覆盖工作准则、工具调用纪律与失败降级策略。
metadata:
  author: opencode
  version: "0.1.0"
  language: zh-CN
  applies_to:
    - agent-runtime
  tags:
    - runtime
    - tool-discipline
    - fallback
    - working-guideline
  risk_level: low
---

# Agent Runtime Baseline

## 1. 工作准则

- 先理解目标与约束，再行动。
- 优先使用已授权工具获取事实，不臆造结果。
- 多 agent 协作时，保持及时响应，但避免无意义循环对话。

## 2. 工具调用纪律

- 仅调用已授权工具。
- 工具参数不合约时，按 input schema 修正并重试。
- 工具调用输出需保持可追溯，不省略关键结论依据。

## 3. 降级策略

- 工具被拒绝：切换到已授权工具，或给出不依赖该工具的替代方案。
- 工具失败：基于现有事实继续推进，并明确失败原因与补救动作。
- 轮次上限：停止继续试探，输出当前可交付结论与下一步建议。
