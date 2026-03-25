# PROMPT & SKILL BOUNDARY GUIDE

## 1. 设计边界

- 代码层负责：场景识别、skill 激活、动态参数注入、兜底降级。
- Skill 层负责：场景策略、异常处理步骤、回执模板、反幻觉约束。

## 2. 关键链路（2026-03-21）

- Prompt Registry：`backend/apps/agents/src/modules/prompt-registry/agent-prompt-catalog.ts`
- 执行消息拼装与 skill 注入：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`
- OpenCode 空回复重试（复用 catalog prompt）：
  - `backend/apps/agents/src/modules/agents/executor-engines/opencode-agent-executor.engine.ts`
  - `backend/apps/agents/src/modules/agents/executor-engines/opencode-streaming-agent-executor.engine.ts`

## 3. 场景映射

- 会议执行策略：`meeting-sensitive-planner`
- 会议异常恢复：`meeting-resilience`
- 模型管理 grounding：`model-management-grounding`
- 运行时通用基线：`agent-runtime-baseline`
- 强制动作模板：`forced-action-template`

## 4. 激活规则（当前实现）

- 基础规则：tag 命中 `task.type`、planning 特征、关键词命中数。
- 显式增强：
  - 会议任务优先激活 `meeting-resilience` / `meeting-sensitive-planner`
  - 模型管理任务优先激活 `model-management-grounding`
  - before-step 产生 `forcedToolCall` 时，优先读取 `forced-action-template` 渲染指令

## 5. 兼容策略

- `AGENT_PROMPTS` 保留 symbol/slug/scene/role，`code_default` 作为无 skill 时兜底。
- OpenCode 引擎重试补充文本复用 catalog，避免重复维护。
