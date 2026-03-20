# Agent Executor Engine 路由重构计划

## 1. 背景与目标

- 背景：`AgentExecutorService.executeTaskDetailed` 与 `executeTaskWithStreaming` 当前在方法内部按 `executionChannel` 分支执行 runtime，随着后续接入 Codex 等新通道，单方法内继续堆叠条件判断会放大复杂度。
- 目标：将“按执行通道 + 执行模式选择具体运行实现”的逻辑封装为可扩展的 executor engine 体系，使 `AgentExecutorService` 只负责公共准备/收尾编排，具体执行下沉到独立实例。

## 2. 执行步骤

1. 盘点 `AgentExecutorService` 中 detailed/streaming 两条执行链的公共准备、路由与收尾边界，明确哪些能力继续留在主服务、哪些能力下沉到 engine。
2. 设计统一 `AgentExecutorEngine` 协议与执行上下文，覆盖 detailed/streaming 两种模式下所需的输入（runtimeContext、messages、modelConfig、onToken、OpenCode runtime 等）。
3. 新增 `NativeAgentExecutorEngine`、`NativeStreamingAgentExecutorEngine`、`OpencodeStreamingAgentExecutorEngine` 等实现，分别承载对应通道/模式的实际执行逻辑，并保留现有行为等价。
4. 在 `AgentExecutorService` 中新增 engine 选择入口，根据 `executionChannel` 与执行模式路由到具体实例，移除方法内部大段通道分支。
5. 校对依赖注入与模块装配，确保后续新增 `codex` 等执行通道时只需新增 engine 并注册，不必修改主执行编排。
6. 补充/更新测试，覆盖 detailed/streaming 路由选择、native/opencode 分支行为与关键回归场景。
7. 同步更新 Runtime 功能文档与当日日志，记录新的 executor engine 架构边界。

## 3. 关键影响点

- 后端：`backend/apps/agents/src/modules/agents/agent-executor.service.ts` 执行编排主入口。
- 后端：`backend/apps/agents/src/modules/agents/` 新增 executor engine 协议、实现类与 DI 装配。
- 后端：涉及 OpenCode/native runtime 调用的依赖传递方式与后续扩展点。
- 测试：`agent-executor.service.spec.ts` 及相关单测需要覆盖新的 engine 路由。
- 文档：`docs/feature/AGENT_RUNTIME.md`、`docs/dailylog/`。

## 4. 风险与依赖

- detailed 与 streaming 在副作用（预算闸门、delta 事件、空响应重试）上并不完全一致，抽象过度会导致行为漂移，需要保留模式差异。
- Nest DI 若直接注入多个同类 engine，需避免循环依赖或 token 冲突。
- 若后续要支持 `codex` 等新通道，engine 协议需优先按“扩展新实例”设计，避免再次把分支逻辑塞回主服务。
