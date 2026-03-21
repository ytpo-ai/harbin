# SYSTEM CONTEXT LAYERED ARCHITECTURE

## 目标

- 将 system context 从“会话历史消息”剥离为“run 级执行包络（runtime envelope）”。
- 统一 system 注入来源，避免 Meeting/Executor/Builder 多源重复注入。
- 通过 fingerprint 抑制静态与半静态 block 的重复发送，控制 token 与存储膨胀。

## 核心分层

### 1) 组装层（ContextAssembler + Builders）

- 入口：`backend/apps/agents/src/modules/agents/context/context-assembler.service.ts`
- Builder 协议：`context-block-builder.interface.ts`
  - 新增 `meta.scope`（`run|session`）与 `meta.stability`（`static|semi-static|dynamic`）
  - `assemble()` 返回 `AssembledContext`：`messages`、`systemBlockCount`、`blockMetas`
- 关键行为：
  - `previousMessages` 仅保留 `user/assistant/tool`
  - 丢弃历史中的 `system`，system 统一由 builder 链生成

### 2) 抑制层（Fingerprint）

- 服务：`context-fingerprint.service.ts`
- 规则：
  - static/semi-static block 按 `scope + blockType + snapshot` 做变更检测
  - 未变化返回 `null`（不注入），变化时注入 full 或 delta
- 当前覆盖：
  - `identity-base`（guideline + systemPrompt）
  - `identity`（identity memos，支持 delta）
  - `domain`
  - `collaboration`
  - `toolset-spec`
  - `task-info`（支持 delta）

### 3) 持久化层（Runtime）

- `runtime-orchestrator.startRun()` 不再创建 `system` 角色 `AgentMessage`
- `prepareExecution` 不再追加 system 到 `session.messages`
- 审计数据改为：`run.metadata.initialSystemMessages`
- 会话历史仅保留对话与工具交互：`user/assistant/tool`

## Meeting 链路约束

- `meeting.service.ts`
  - `buildMeetingResponseContext()` 只构建 user/assistant 历史 + trigger user 消息
  - `catchUpAgent()` 的 task.messages 不再注入 system
- 会议上下文由 `CollaborationContextBuilder` 与 `TaskContextBuilder` 承担

## 关键去重键（保险层）

- 工具：`context-fingerprint.util.ts#buildSystemContextKey`
- 覆盖：`collab`、`meeting_brief`、`identity_memo`、`domain`、`task_info`、`tool_injection`、`tool_strategy`、`skill_index`、`run_summaries`、`memo_recall`
- 作用：即使外部路径误注入 system，也可按语义类别去重。
