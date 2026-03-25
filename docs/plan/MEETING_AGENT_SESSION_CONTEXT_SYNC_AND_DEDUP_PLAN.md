# [Deprecated] 会议 Agent Session 上下文补齐与去重计划

> **状态：已过期**
> 本计划的核心目标（入会 catch-up 上下文补齐、session system message 去重）已被 `SYSTEM_CONTEXT_LAYERED_ARCHITECTURE_PLAN.md` 架构级根治方案覆盖。
> 具体落地 commit: `373e1dc refactor(backend): layer system context as run-scoped envelope`
> - 会议上下文统一由 CollaborationContextBuilder + TaskContextBuilder 生成，catch-up 路径不再注入 system prompt
> - session.messages 不再写入 system 消息，去重策略已无需保留

## 背景

会议场景中存在两个体验问题：

1. 新邀请 Agent 入会后，session 未及时出现“团队上下文 + 会议情况表述”。
2. 已在会中的 Agent 每轮对话会重复写入上述 system 内容。

## 执行步骤

1. 梳理入会 catch-up 路径，补齐首次入会时的 teamContext 注入。
2. 抽取统一的会议 system 表述构造逻辑，确保常规回应和 catch-up 使用同一模板。
3. 为 catch-up 执行补充会议上下文（meetingId/title/description/agenda/participants/profiles），确保新 Agent 首轮即有完整上下文。
4. 增强 session system message 去重策略（标准化文本去重 + 会议上下文特征去重），避免轮次重复追加。
5. 运行后端构建验证，确认 legacy/agents 编译通过。

## 关键影响点

- 后端会议模块：`backend/src/modules/meetings/meeting.service.ts`
- Agents runtime 持久化：`backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`

## 风险与依赖

- 风险：去重过严可能吞掉必要更新。
  - 缓解：仅对“同 session 同语义上下文块”去重，不影响普通用户/assistant 消息。
- 风险：catch-up 注入更多上下文后 token 开销上升。
  - 缓解：保持摘要窗口（最近 5 条）与上下文字段最小集。
