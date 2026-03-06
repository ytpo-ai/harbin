# 会议参会人上下文同步开发总结

> 状态：已并入统一主总结 `docs/development/MEETING_CAPABILITY_MASTER_PLAN.md`，本文件保留历史细节。

## 目标

在会议场景中实现参会人信息与模型上下文的自动同步：
- 会议开始时初始化参会人上下文。
- 新增/移除参会人时更新参会人上下文。
- Agent 执行时可读取结构化参会人信息。

## 实现内容

1. 新增参会人上下文结构
   - 在会议服务中新增 `ParticipantContextProfile` 结构，包含：`id/type/name/role/isPresent`，并携带专属助理标识字段用于增强语义。
   - 对参会人做去重（`type:id`）并过滤无效记录。

2. 增加参会人上下文构建与摘要方法
   - `buildParticipantContextProfiles`：统一组装结构化参会人数据。
   - `formatParticipantContextSummary`：将结构化数据转为可读摘要文本。
   - 名称解析策略：优先员工/Agent展示名，失败时回退到 ID，避免上下文构建失败。

3. 会议开始时初始化上下文
   - 在 `startMeeting` 流程中，会议开始系统消息之后追加“参会人上下文已初始化”系统消息。

4. 成员增删时同步更新上下文
   - 在 `addParticipant` 成功后追加“参会人上下文已更新”系统消息。
   - 在 `removeParticipant` 成功后追加“参会人上下文已更新”系统消息。

5. 注入 Agent 执行上下文
   - 在 `generateAgentResponse` 中保留原有 `teamContext.participants`（ID 列表），新增 `teamContext.participantProfiles`（结构化参会人信息），保持向后兼容。

6. 强化讨论系统提示
   - `buildDiscussionContext` 变更为异步，注入“参会人详情”摘要，帮助模型在回复时准确识别当前参与者。

## 文档更新

- 更新 `docs/api/API.md`：补充会议参会人上下文同步规则、触发时机、以及 `teamContext.participantProfiles` 说明。

## 验证结果

- 已执行：`npm run build`（backend）
- 结果：构建通过。

## 兼容性与注意事项

- 向后兼容：未移除现有 `teamContext.participants`。
- 异常兜底：人员名称查询失败时回退为 ID，不影响主流程。
- 可观测性：通过系统消息可在会议消息流中明确看到上下文初始化/更新时机。

---

## 计划原文（合并归档：MEETING_PARTICIPANTS_CONTEXT_SYNC_PLAN.md）

# 会议参会人上下文同步计划

> 状态：已并入统一主计划 `docs/plan/MEETING_CAPABILITY_MASTER_PLAN.md`，本文件保留历史细节。

## 需求目标

当会议开始时，将当前参会人员信息注入到会议上下文，供模型理解“当前有哪些参会人”；当新增或移除参会人时，同步刷新该上下文，保持一致性。

## 执行步骤

1. 梳理会议服务中“会议开始、参会人新增、参会人移除、Agent 调用上下文构建”链路，确认统一注入点。
2. 新增参会人上下文构建能力：按 `id/type/name/role/isPresent` 生成结构化列表，并过滤无效值。
3. 在会议开始后写入一次“参会人上下文已初始化”的系统上下文消息，确保后续对话可感知。
4. 在新增/移除参会人后写入“参会人上下文已更新”的系统上下文消息，保持模型上下文同步。
5. 将结构化参会人信息注入 Agent 执行 `teamContext`，并在讨论系统提示中输出可读参会人摘要。
6. 更新相关文档（API/README 中会议上下文字段说明）并完成本地校验。

## 关键影响点

- 后端：`meeting.service.ts` 的上下文构建与会议事件链路。
- Agent 执行上下文：`teamContext` 字段扩展（保持兼容）。
- 会议消息流：新增上下文同步类系统消息。
- 文档：会议上下文说明更新。

## 风险与依赖

- 参会人名称来源依赖员工/Agent服务，若查询失败需回退到 ID，避免中断。
- 上下文字段需要向后兼容，避免影响既有依赖 `participants`（ID 列表）的逻辑。
- 频繁增删参会人可能导致系统消息增多，需要控制消息内容长度与可读性。

## 需求补充（本轮）

- “参会人上下文已更新”系统消息改为人数表达：`参会人上下文已更新：当前参会X人`。
- 移除参会人系统消息应展示可读名称（如 `Kim`），不展示裸 ID。
- 会议聊天上下文中的发言者标识改为显示名称，避免出现 `agentId/employeeId`。
