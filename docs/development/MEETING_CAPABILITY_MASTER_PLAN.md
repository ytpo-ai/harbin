# 会议能力统一开发总结（合并版）

## 合并目的

将会议相关开发总结统一收敛，避免同一能力在多个总结文档中重复维护，形成“主总结 + 历史明细”的结构。

## 合并来源

- `docs/development/MEETING_CHAT_UPGRADE_PLAN.md`
- `docs/development/MEETING_PARTICIPANTS_CONTEXT_SYNC_PLAN.md`
- `docs/development/HUMAN_EXCLUSIVE_ASSISTANT_MEETING_PLAN.md`

## 统一交付概览

1. 会议/聊天体验
   - 支持 `/meetings/:meetingId` 单会议独立页
   - 输入框支持 `@成员` 提示与键盘选择
   - 右侧会议操作区（改名、成员管理）与默认折叠
   - 输入框 `↑/↓` 历史消息回填
   - 会议头部操作与状态刷新优化

2. 参会人上下文同步
   - 会议开始/增删成员时自动写入上下文系统消息
   - `teamContext` 注入 `participantProfiles` 结构化信息
   - 讨论上下文支持可读参会人摘要

3. 专属助理会议机制
   - 人类账号必须绑定专属助理才可发起/参与会议
   - 登录后未绑定阻断并支持一键创建绑定
   - 人类发起会议时由专属助理担任主持人
   - 人类会中消息自动映射为专属助理身份发送
   - 专属助理仅在对应人类显式 `@` 时响应

4. Agent 思考状态后端化
   - 新增 `agent_state_changed` 事件
   - Redis 短期存储 Agent thinking 状态
   - 提供 `GET /meetings/:id/agent-states` 快照接口
   - 前端改为“快照 + WS 增量”同步

## 结果状态

- 已完成：上述能力均已落地并完成构建验证（历史总结中有对应记录）。
- 当前建议：后续会议相关开发总结优先追加到本文件，历史文档仅保留细节。

## 关联计划

- 统一计划入口：`docs/plan/MEETING_CAPABILITY_MASTER_PLAN.md`

## 备注

- 本文档不替代历史细节文档；如需实现细节、文件级变更、问题修复轨迹，请查阅原专题总结。
