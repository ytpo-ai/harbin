# Fix: Native Streaming 工具调用缺失 & 异步任务 Prompt 未注入

## 1. 基本信息

- 标题：Native Streaming 引擎不支持工具调用 & Agent Task Worker 未将 prompt 注入 user message
- 日期：2026-03-23
- 负责人：AI Agent
- 关联需求/会话：PROMPT_IMPORT_REPO_WRITER_TOOL_PLAN — 3 工具联动测试
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：通过 `POST /api/agents/tasks`（异步任务）让 Agent 执行三工具联动（repo-writer → repo-read → save-prompt-template）时，Agent 返回泛化回复（"请告诉我你要做的任务"），未执行任何工具
- 触发条件：使用 async task API 且 Agent 走 native channel（config 为空或无 opencode 配置）
- 影响范围：所有通过 `POST /api/agents/tasks` 异步任务路径执行的 native channel Agent
- 严重程度：高

## 3. 根因分析

### Bug 1: task.prompt 未注入为 user message

- 直接原因：`agent-task.worker.ts` 构建 `runtimeTask` 时，将 `task.prompt` 放在 `description` 字段，`messages` 为空数组 `[]`
- 深层原因：`ContextAssemblerService.assemble()` 仅从 `context.previousMessages`（即 `task.messages`）中提取 user/assistant 消息。`task.description` 仅在 orchestration/meeting 场景作为 system message 注入，在 chat 场景完全丢失
- 相关模块/文件：
  - `backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts:120-130`
  - `backend/apps/agents/src/modules/agents/context/context-assembler.service.ts:53-54`

### Bug 2: NativeStreamingEngine 不支持工具调用

- 直接原因：`NativeStreamingAgentExecutorEngine` 只执行一次 `streamingChat`，不检查 LLM 输出中的 `<tool_call>` 标签
- 深层原因：streaming 引擎设计时仅考虑了纯文本输出，未像 `NativeAgentExecutorEngine`（detailed 模式）那样接入 `executeWithToolCalling` 多轮循环
- 相关模块/文件：
  - `backend/apps/agents/src/modules/agents/executor-engines/native-streaming-agent-executor.engine.ts`
  - 对比：`native-agent-executor.engine.ts` 正确调用了 `executeWithToolCalling`

## 4. 修复动作

### Fix 1: 注入 prompt 为 user message

在 `agent-task.worker.ts` 的 `runtimeTask` 构造中，将 `task.prompt` 作为 user message 注入 `messages[]`：

```typescript
messages: [
  {
    role: 'user' as const,
    content: task.prompt,
    timestamp: new Date(),
  },
],
```

### Fix 2: Streaming 引擎支持工具调用

将原有 `execute()` 方法的流式逻辑提取为 `streamOnce()` 私有方法，在 `execute()` 中：
1. 先执行一轮 `streamOnce()` 获取 LLM 完整输出
2. 用 `extractToolCall()` 检测是否包含工具调用
3. 若检测到，fallback 到 `executeWithToolCalling` 多轮工具循环
4. 若无工具调用，直接返回文本

```typescript
const firstRound = await this.streamOnce(input, onToken);
const toolCall = extractToolCall(firstRound.response);
if (toolCall) {
  // fallback to multi-round tool-calling loop
  const response = await input.executeWithToolCalling(...);
  return { response, tokenChunks: firstRound.tokenChunks };
}
return { response: firstRound.response, tokenChunks: firstRound.tokenChunks };
```

### 兼容性处理

- Fix 1 对已有 detailed 模式（`POST /api/agents/:id/execute`）无影响，该路径通过 `task.messages` 直接传入 user message
- Fix 2 保持了原有 streaming 行为：无工具调用时与修改前完全一致；仅在检测到 `<tool_call>` 时额外 fallback

## 5. 验证结果

### 验证步骤

1. **单工具测试（via execute endpoint）**
   - repo-writer git-clone：成功 clone 204 个文件
   - repo-read find + cat：成功分析 Agent Prompt
   - save-prompt-template：成功批量导入 2 个 Prompt (draft)

2. **三工具联动测试（via async task API）**
   - 发送 `POST /api/agents/tasks` 给 Coder-T Agent
   - Agent 依次执行：clone → 分析 → 导入
   - 最终结果：repo clone 成功，读取分析成功，Prompt 导入成功（v2 draft）

3. **Streaming 引擎 fallback 验证**
   - 日志确认：`[native_stream_tool_detected] taskId=... tool=... — falling back to executeWithToolCalling`
   - Kim-CTO Agent 的其他任务也成功触发了 fallback 并执行工具

### 验证结论：通过

### 测试与检查

- TypeScript 编译检查通过（无新增编译错误）
- 三工具联动端到端测试通过
- streaming 引擎 fallback 路径实际触发并成功执行

## 6. 风险与后续

### 已知风险

- streaming 引擎的 fallback 会导致第一轮 streaming token 已发送给客户端（包含 `<tool_call>` 内容），然后 `executeWithToolCalling` 重新执行一遍完整的多轮循环。客户端可能看到重复的第一轮输出
- LLM 有时用自然语言描述工具调用意图而非输出 `<tool_call>` 标签，需要 `AgentAfterStepEvaluationHook` 重试机制配合

### 后续优化

- 考虑在 streaming 引擎中实现原生的 streaming + tool-calling 混合模式，避免 fallback 导致的重复
- 监控 `tool_intent_without_execution` 重试率，优化 prompt 指令强化效果

### 是否需要补充功能文档/API文档

- 否（本次为 bug fix，不涉及功能变更）
