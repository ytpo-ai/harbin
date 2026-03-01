# 会议参会人上下文同步开发总结

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
