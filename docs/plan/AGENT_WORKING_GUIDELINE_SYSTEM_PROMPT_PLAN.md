# Agent 工作准则 System Prompt 注入计划

## 1. 背景与目标

- 背景：当前 `AgentExecutorService.buildMessages` 的首条 system 消息直接使用 `agent.systemPrompt`，缺少统一、稳定的“Agent 工作准则”约束入口。
- 目标：在 `AGENT_PROMPTS` 中新增“Agent 工作准则”模板，并在构建消息时始终将其作为第一条 system prompt 注入，确保后续运行时行为具备一致的基础约束。

## 2. 执行步骤

1. 在 `apps/agents` 的 Prompt 目录新增一个 `AGENT_PROMPTS` 条目，定义“Agent 工作准则”默认文案（支持 Prompt Registry 覆盖）。
2. 调整 `AgentExecutorService.buildMessages` 的 system 消息构建顺序：先注入“工作准则”prompt，再注入 `agent.systemPrompt` 与其他系统上下文。
3. 保持 Prompt Resolver 回退链路不变，确保 Redis/模板未命中时使用代码默认文案。
4. 更新 `agent-executor.service.spec.ts`，覆盖“首条 system prompt 为工作准则”的顺序断言，防止后续回归。
5. 运行 agents 模块相关单测，验证消息构建逻辑和既有行为兼容。

## 3. 关键影响点

- 后端：`backend/apps/agents/src/modules/prompt-registry/agent-prompt-catalog.ts`
- 后端：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`
- 测试：`backend/apps/agents/src/modules/agents/agent-executor.service.spec.ts`

## 4. 风险与依赖

- system prompt 顺序变化可能影响模型输出风格，需要通过既有单测与关键场景回归确认无行为漂移。
- 若 `agent.systemPrompt` 为空字符串，仍需确保“工作准则”提示稳定注入，避免出现无基础约束执行。
