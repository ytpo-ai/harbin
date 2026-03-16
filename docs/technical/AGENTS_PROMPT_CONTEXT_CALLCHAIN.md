# Agents Prompt Context Callchain

## 1. 术语说明

- 本文统一使用 `prompt`。

## 2. 结论速览

- `backend/apps/agents` 中，prompt 注入上下文主要分为 4 类：
  1. Agent 级系统提示词：`agent.systemPrompt`。
  2. 工具级提示词：`tool.prompt`（按已授权工具注入 system 消息）。
  3. 用户任务提示词：`taskPrompt`（取最近 user 内容，主要给 OpenCode）。
  4. 编排提示词：`orchestration.create/update` 的 `prompt`（透传到编排 API，不直接进入 LLM `messages`）。
- Prompt 最终有两类消费路径：
  - 进入 LLM `messages`（native/streaming chat）。
  - 进入 OpenCode message body（`parts[].text`）或编排 API payload。
- Runtime 侧会持久化两类上下文：
  - system 消息快照（session）。
  - userContent（run）。

## 3. Prompt 类型与写入点矩阵

| Prompt 类型 | 来源 | 写入点 | 是否进入 LLM `messages` | 是否持久化到 Runtime | 主要代码位置 |
|---|---|---|---|---|---|
| `systemPrompt` | Agent 配置字段 | `buildMessages()` 首条 system 消息 | 是 | 是（session system messages） | `backend/apps/agents/src/modules/agents/agent.service.ts:1144` |
| `tool.prompt` | Tool 配置/内置目录 | `buildToolPromptMessages()` -> system 消息追加 | 是 | 是（session system messages） | `backend/apps/agents/src/modules/agents/agent.service.ts:1203`, `backend/apps/agents/src/modules/agents/agent.service.ts:1265` |
| `taskPrompt` | 最近 user 消息（无则 description/title） | OpenCode 执行入参 | 否（不走 messages 队列） | 间接（run.userContent） | `backend/apps/agents/src/modules/agents/agent.service.ts:821`, `backend/apps/agents/src/modules/opencode/opencode-execution.service.ts:30`, `backend/apps/agents/src/modules/opencode/opencode.adapter.ts:41` |
| `orchestration create prompt` | 会议/用户指令 | orchestration tool payload `prompt` | 否 | 否（由编排服务侧处理） | `backend/apps/agents/src/modules/agents/agent-orchestration-intent.service.ts:80`, `backend/apps/agents/src/modules/tools/orchestration-tool-handler.service.ts:216` |
| `orchestration update prompt` | 用户更新计划入参 | orchestration API payload `sourcePrompt` | 否 | 否（由编排服务侧处理） | `backend/apps/agents/src/modules/tools/orchestration-tool-handler.service.ts:294`, `backend/apps/agents/src/modules/tools/orchestration-tool-handler.service.ts:299` |

## 4. 调用链图

### 4.1 普通执行（Native，含工具调用）

```mermaid
sequenceDiagram
    participant C as AgentController
    participant S as AgentService
    participant E as AgentExecutionService
    participant M as ModelService
    participant R as RuntimeOrchestrator

    C->>S: executeTaskDetailed(task, context)
    Note over C,S: context 注入 actor/teamContext
    S->>S: buildMessages()
    Note over S: 注入 systemPrompt + tool.prompt + 任务/团队/记忆
    S->>E: startRuntimeExecution(messages)
    E->>R: startRun(userContent)
    S->>E: appendSystemMessagesToSession(messages[system])
    E->>R: appendSystemMessagesToSession(...)
    S->>M: chat(messages)
    Note over M: LLM 实际消费完整 messages
    S->>R: tool.pending/running/completed/failed (如有)
    S->>E: completeRuntimeExecution(response)
    E->>R: completeRun(...)
```

### 4.2 流式执行（Streaming）

```mermaid
sequenceDiagram
    participant C as Stream/Controller
    participant S as AgentService
    participant E as AgentExecutionService
    participant M as ModelService
    participant R as RuntimeOrchestrator

    C->>S: executeTaskWithStreaming(task, context)
    S->>S: buildMessages()
    Note over S: 注入 systemPrompt + tool.prompt
    S->>E: startRuntimeExecution(mode=streaming)
    E->>R: startRun(userContent)
    S->>E: appendSystemMessagesToSession(...)
    E->>R: appendSystemMessagesToSession(...)
    S->>M: streamingChat(messages, onToken)
    S->>R: recordLlmDelta(token)
    S->>E: completeRuntimeExecution(fullResponse)
```

### 4.3 OpenCode 执行（taskPrompt 路径）

```mermaid
sequenceDiagram
    participant S as AgentService
    participant O as OpenCodeExecutionService
    participant A as OpenCodeAdapter
    participant R as RuntimeOrchestrator

    S->>S: resolveLatestUserContent(task, messages)
    S->>O: executeWithRuntimeBridge(taskPrompt)
    O->>O: startExecution(taskPrompt)
    O->>A: promptSession(sessionId, prompt)
    A->>A: POST /session/{id}/message (parts[].text=prompt)
    O->>R: recordLlmDelta(...)
```

### 4.4 编排计划执行（Orchestration Prompt 透传）

```mermaid
sequenceDiagram
    participant I as AgentOrchestrationIntentService
    participant S as AgentService
    participant T as OrchestrationToolHandler
    participant API as Internal Orchestration API

    I->>S: forced action (tool=create-plan, parameters.prompt=latestUser)
    S->>T: executeTool(create-plan, params)
    T->>T: 校验 params.prompt
    T->>API: POST /plans/from-prompt {prompt, title, mode...}
    API-->>T: plan result
    T-->>S: tool result
```

## 5. 场景化梳理（哪些逻辑会“填入 prompt”）

### 5.1 Agent 系统提示词注入

1. Agent 创建/更新时维护 `systemPrompt`（默认值会自动补齐）。
2. 任务执行进入 `buildMessages()` 后，`systemPrompt` 被写入第一条 `system` 消息。
3. 该 system 消息参与模型调用，并会被追加到 runtime session。

关键位置：

- `backend/apps/agents/src/modules/agents/agent.service.ts:224`
- `backend/apps/agents/src/modules/agents/agent.service.ts:1144`
- `backend/apps/agents/src/modules/agents/agent-execution.service.ts:67`

### 5.2 工具提示词（tool.prompt）注入

1. 内置工具目录可定义 `prompt`。
2. Tool 初始化时把 `prompt` 同步到工具文档（DB）。
3. Agent 执行时读取已授权工具，提取非空 `tool.prompt`，拼装为 `工具使用策略（toolId）` 的 system 消息。
4. 这些 system 消息进入 LLM `messages`，并落入 runtime session。

关键位置：

- `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts:91`
- `backend/apps/agents/src/modules/tools/tool.service.ts:481`
- `backend/apps/agents/src/modules/agents/agent.service.ts:1203`
- `backend/apps/agents/src/modules/agents/agent.service.ts:1265`

### 5.3 OpenCode 的 taskPrompt 填充

1. 在 detailed/streaming 执行中，如果命中 OpenCode 通道，都会先取 `resolveLatestUserContent()`。
2. 该内容作为 `taskPrompt` 传入 OpenCode 执行服务。
3. Adapter 最终将其写入 `/session/{id}/message` 的 `parts[].text`。

关键位置：

- `backend/apps/agents/src/modules/agents/agent.service.ts:821`
- `backend/apps/agents/src/modules/agents/agent.service.ts:1028`
- `backend/apps/agents/src/modules/opencode/opencode-execution.service.ts:30`
- `backend/apps/agents/src/modules/opencode/opencode.adapter.ts:41`

### 5.4 编排场景 prompt 透传

1. 会议意图识别命中“创建计划”时，强制工具调用参数中写入 `prompt: latestUser`。
2. Orchestration handler 校验 `prompt` 并透传到 `/plans/from-prompt`。
3. 更新计划场景会把 `params.prompt` 转写为 `payload.sourcePrompt`。
4. 该类 prompt 不进入 Agent LLM `messages`，而是作为编排服务输入。

关键位置：

- `backend/apps/agents/src/modules/agents/agent-orchestration-intent.service.ts:80`
- `backend/apps/agents/src/modules/tools/orchestration-tool-handler.service.ts:192`
- `backend/apps/agents/src/modules/tools/orchestration-tool-handler.service.ts:216`
- `backend/apps/agents/src/modules/tools/orchestration-tool-handler.service.ts:299`

## 6. Runtime 持久化视角（排查“到底注入了什么”）

可从两条线并行验证：

1. **System Prompt 注入是否生效**
   - 查看 runtime session 中追加的 system 消息（来源标记 `source=buildMessages`）。
   - 关键入口：`backend/apps/agents/src/modules/agents/agent-execution.service.ts:67`。

2. **用户 Prompt（taskPrompt/userContent）是否生效**
   - 查看 run 的 `userContent`（来自 `resolveLatestUserContent`）。
   - 关键入口：`backend/apps/agents/src/modules/agents/agent-execution.service.ts:105`。

## 7. 常见误区

- 误区 1：`orchestration prompt` 会进入模型消息上下文。  
  实际：多数编排 prompt 直接透传给 Orchestration API，不进入 `messages`。

- 误区 2：只有 `systemPrompt` 才是“提示词”。  
  实际：`tool.prompt` 同样会被注入 system 消息，且优先级高于自由生成时的策略解释。

- 误区 3：OpenCode 与 native 路径都吃同一份 `messages`。  
  实际：OpenCode 核心输入走 `taskPrompt`，native/streaming 才直接用 `messages`。

## 8. 代码索引（快速跳转）

- `backend/apps/agents/src/modules/agents/agent.controller.ts:160`
- `backend/apps/agents/src/modules/agents/agent.service.ts:748`
- `backend/apps/agents/src/modules/agents/agent.service.ts:1133`
- `backend/apps/agents/src/modules/agents/agent.service.ts:1203`
- `backend/apps/agents/src/modules/agents/agent.service.ts:1757`
- `backend/apps/agents/src/modules/agents/agent-execution.service.ts:54`
- `backend/apps/agents/src/modules/agents/agent-execution.service.ts:98`
- `backend/apps/agents/src/modules/opencode/opencode-execution.service.ts:26`
- `backend/apps/agents/src/modules/opencode/opencode.adapter.ts:38`
- `backend/apps/agents/src/modules/agents/agent-orchestration-intent.service.ts:73`
- `backend/apps/agents/src/modules/tools/orchestration-tool-handler.service.ts:175`
- `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts:88`
- `backend/apps/agents/src/modules/tools/tool.service.ts:445`
