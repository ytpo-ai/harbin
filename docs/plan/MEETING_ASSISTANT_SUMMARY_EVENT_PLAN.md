# 会议总结改为会议助手事件驱动生成计划

## 背景与目标

- 当前会议在 `endMeeting` 主流程中同步生成总结，会让结束链路耦合总结执行时延与异常。
- 目标改为：会议结束后只发送一条 inner message 事件，会议助手（`meeting-assistant`）订阅并异步生成总结。

## 执行步骤

1. 调整会议结束流程：`MeetingService.endMeeting` 去除同步总结调用，改为发布 `meeting.ended` inner message（携带 `meetingId`、`title`、`endedAt` 等）。
2. 新增会议总结自动化服务：启动时确保 `meeting-assistant` 订阅 `meeting.ended`，并监听其 inbox 通道消息。
3. 在自动化服务中实现消息处理：收到 `meeting.ended` 后执行业务确认、消息状态回执（processing/processed）、触发会议总结生成。
4. 重构总结生成入口：将会议总结生成提炼为可复用方法，由会议助手身份执行，并增加幂等保护（已有总结时跳过）。
5. 补充日志与失败兜底：总结失败不阻断会议结束，记录错误与处理结果，避免消息无限悬挂。
6. 更新功能文档：同步 `docs/feature/MEETING_CHAT.md` 的“会议总结生成机制”说明与相关代码清单。

## 关键影响点

- 后端（会议域）：`backend/src/modules/meetings/*`
- 后端（inner message）：`backend/src/modules/inner-message/*`
- 文档：`docs/feature/MEETING_CHAT.md`

## 风险与依赖

- 依赖 Redis 可用性（inner message dispatch/inbox 订阅链路）。
- `meeting-assistant` 为系统约定 agentId，需确保环境中存在并可执行任务。
- 异步化后总结可能略晚于会议结束落库，需要前端按“稍后可见”语义处理。
