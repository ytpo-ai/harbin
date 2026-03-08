# 会议监控开发计划

## 概述

复用现有的 Scheduler 定时计划机制，实现会议空闲状态监控功能。

## 功能需求

1. **定时检查会议**: 每隔 5 分钟检查所有进行中的会议
2. **超时提醒**: 会议 1 小时未有消息时，发送提示消息 "会议一个小时未有消息，将自动结束"
3. **自动结束**: 会议 2 小时未有消息，自动结束会议

## 执行步骤

### 1. 修改 SchedulerService

在 `backend/src/modules/orchestration/scheduler/scheduler.service.ts` 中：

1. 添加 `ensureMeetingMonitorSchedule()` 方法，在启动时创建内置定时计划
2. 添加 `executeMeetingMonitor()` 方法，处理会议检查逻辑
3. 添加 `listActiveMeetings()`、`processMeeting()`、`sendWarningMessage()`、`endMeeting()` 等辅助方法

### 2. 实现会议超时检查逻辑

- 查询 status='active' 的会议
- 计算最后消息时间差
- 超过 1 小时：发送提醒消息
- 超过 2 小时：结束会议

### 3. 配置项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| MEETING_ASSISTANT_INTERVAL_MS | 300000 | 检查间隔 (5分钟) |
| MEETING_INACTIVE_WARNING_MS | 3600000 | 提醒超时 (1小时) |
| MEETING_INACTIVE_END_MS | 7200000 | 结束超时 (2小时) |
| BACKEND_API_URL | http://localhost:3001/api | backend API 地址 |

## 关键影响点

- **后端**: 复用 Scheduler 定时计划机制
- **API**: 调用现有的 meeting API
- **定时计划**: 创建内置计划 `system-meeting-monitor`

## 状态

- [x] 待开发
- [x] 开发中
- [ ] 待测试
- [ ] 完成
