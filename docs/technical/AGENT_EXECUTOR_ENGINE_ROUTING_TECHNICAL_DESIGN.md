# Agent Executor Engine 路由技术设计

## 1. 文档目的

将 `AgentExecutorService` 从“按 `executionChannel` 内联分支执行”重构为“按通道/模式路由到独立 Engine”，为后续接入 `codex` 等新执行通道提供稳定扩展点。

## 2. 背景与问题

1. `executeTaskDetailed` 与 `executeTaskWithStreaming` 同时承担公共编排与执行细节，方法体过大。
2. `native/opencode` 分支在两个入口内重复出现，扩展新通道需要高风险修改主链路。
3. 当前结构不利于按执行环境做单测隔离与渐进演进。

## 3. 设计目标

1. 主服务聚焦公共编排：路由解析、runtime 生命周期、memo 侧写、失败收敛。
2. 执行逻辑下沉到 Engine：不同通道/模式由独立实现承载。
3. 扩展新通道时做到“新增实现 + 注册路由”，不修改主执行流程。
4. 保持行为等价：预算门禁、空响应兜底、SSE token 行为、runtime 事件不回退。

## 4. 架构设计

### 4.1 分层

1. 协议层：`AgentExecutorEngine` 接口与统一输入输出上下文。
2. 引擎层：
   - `NativeAgentExecutorEngine`（`detailed/native`）
   - `NativeStreamingAgentExecutorEngine`（`streaming/native`）
   - `OpencodeAgentExecutorEngine`（`detailed/opencode`）
   - `OpencodeStreamingAgentExecutorEngine`（`streaming/opencode`）
3. 路由层：`AgentExecutorEngineRouter`，按 `(mode, channel)` 选择唯一 Engine。
4. 编排层：`AgentExecutorService`，维持公共准备/收尾并调用路由器执行。

### 4.2 路由键模型

- `mode`: `detailed | streaming`
- `channel`: `native | opencode`

路由规则：

1. `executeTaskDetailed` -> `(detailed, executionChannel)`
2. `executeTaskWithStreaming` -> `(streaming, executionChannel)`
3. 路由命中失败立即抛错，禁止 silent fallback。

### 4.3 AgentExecutorService 保留职责

1. 任务初始化：`taskId/messages/runtimeContext`。
2. 路由决策：`resolveExecutionRoute` + gate 校验。
3. runtime 生命周期：`start/complete/fail/release`。
4. memo/event 侧写与失败态收敛。
5. 调用 `AgentExecutorEngineRouter` 并消费 engine 结果。

### 4.4 Engine 职责边界

1. 仅处理“如何执行”本身，不负责 run 生命周期收尾。
2. 输入从统一上下文获取，输出标准化 `response/tokenChunks`。
3. `opencode` 引擎承载 OpenCode Runtime 解析与会话回调。
4. `native` 引擎承载模型调用与 token 增量写入行为。

## 5. 关键流程

### 5.1 Detailed 模式

1. 主服务完成 preflight、runtime start。
2. 路由器命中 `NativeAgentExecutorEngine` 或 `OpencodeAgentExecutorEngine`。
3. Engine 返回最终 `response`。
4. 主服务统一执行 `completeRuntimeExecution` 与 memo 收尾。

### 5.2 Streaming 模式

1. 主服务完成 preflight、runtime start。
2. 路由器命中 `NativeStreamingAgentExecutorEngine` 或 `OpencodeStreamingAgentExecutorEngine`。
3. Engine 通过 `onToken` 回调实时输出并返回聚合 `response/tokenChunks`。
4. 主服务统一执行成功/失败收敛与 runtime 释放。

## 6. 可扩展性设计（面向 Codex）

新增 `codex` 通道时：

1. 增加 `CodexAgentExecutorEngine` 与 `CodexStreamingAgentExecutorEngine`。
2. 扩展 `ExecutionChannel` 联合类型（含 `codex`）。
3. 在 `AgentExecutorEngineRouter` 注册新 engine。

无需改动 `AgentExecutorService` 主执行流程。

## 7. 影响文件

1. `backend/apps/agents/src/modules/agents/agent-executor.service.ts`
2. `backend/apps/agents/src/modules/agents/agent.module.ts`
3. `backend/apps/agents/src/modules/agents/executor-engines/*`
4. `backend/apps/agents/src/modules/agents/agent-executor.service.spec.ts`

## 8. 风险与规避

1. 风险：职责拆分后出现行为漂移。
   - 规避：保持 runtime 生命周期与 memo 行为仍由主服务统一处理。
2. 风险：DI 注册遗漏导致路由失败。
   - 规避：Router 启动时验证引擎集合，缺失即抛错。
3. 风险：streaming token/sequence 行为回退。
   - 规避：沿用原有 token 累积与 `recordLlmDelta` 写入策略。

## 9. 验证方案

在 `backend/` 执行：

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run build:agents
npm test -- apps/agents/src/modules/agents/agent-executor.service.spec.ts --runInBand
```
