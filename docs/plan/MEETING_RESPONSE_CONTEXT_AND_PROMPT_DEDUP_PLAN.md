# [Deprecated] 会议回应上下文与系统提示去重优化计划

> **状态：已过期**
> 本计划的核心目标（session 层面 system message 去重、会议响应去重键）已被 `SYSTEM_CONTEXT_LAYERED_ARCHITECTURE_PLAN.md` 架构级根治方案覆盖。
> 具体落地 commit: `373e1dc refactor(backend): layer system context as run-scoped envelope`
> - system 消息不再写入 session.messages，去重逻辑已无需保留
> - 会议响应去重键（步骤 3）仍在原代码中生效，未受影响

## 背景

在会议讨论场景中，出现了两个稳定问题：

1. Agent 收到的任务描述过于泛化（仅“请对会议中的发言做出回应”），在 session 视角下看不到被回应的具体发言。
2. 同一 session 内系统提示被反复注入，导致上下文噪音升高与日志可读性下降。

## 执行步骤

1. 调整会议任务构建逻辑，将“最新触发发言摘要”写入任务描述，确保 session 可追溯回应对象。
2. 调整会议响应调度逻辑，对 responder 列表按 participantId 去重，避免单次触发下同一 Agent 被重复调度。
3. 在会议响应执行路径增加短窗口去重键（meetingId + agentId + triggerMessageId），拦截近实时重复触发。
4. 在 agents runtime 的 session 持久化层增加 system message 去重，避免同内容系统提示重复写入同一 session。
5. 运行后端构建校验（legacy + agents）确认改动可编译通过。

## 关键影响点

- 后端会议模块：`backend/src/modules/meetings/meeting.service.ts`
- Agents runtime 持久化：`backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`

## 风险与依赖

- 风险：系统提示“精确相同内容去重”可能吞掉少量有意重复的提示。
  - 缓解：仅对同一 session 近窗口内完全一致内容去重，不做语义级模糊合并。
- 风险：响应去重窗口过长可能误拦截真实新任务。
  - 缓解：采用短窗口（15s）并绑定 triggerMessageId，最小化误伤范围。
