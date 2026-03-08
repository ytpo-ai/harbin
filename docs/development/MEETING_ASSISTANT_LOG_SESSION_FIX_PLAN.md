# Scheduler 编排统一化与日志会话链路修复开发总结

## 1. 目标与范围

- 解决会议助理在执行会议监控时存在“有动作但缺少统一编排会话与日志链路”的设计问题。
- 将 `OrchestrationScheduler` 的职责收敛为触发器，执行统一回归 `OrchestrationPlan/Task`。
- 以 `system-meeting-monitor` 为首个改造对象，验证 Scheduler 与 Orchestration 的分层边界。

## 2. 实现内容

### 2.1 调度执行路径统一

- 移除 `SchedulerService` 中 `system-meeting-monitor` 的专用旁路分支。
- 删除在 scheduler 内直接调用 meeting API 的监控实现（list/process/warning/end）。
- 所有定时计划统一走：`dispatchSchedule -> 创建 schedule task -> executeStandaloneTask`。

对应文件：
- `backend/src/modules/orchestration/scheduler/scheduler.service.ts`

### 2.2 系统会议监控计划输入标准化

- 为系统内置计划新增统一构造方法 `buildMeetingMonitorInput()`。
- 将会议监控策略以 `input.prompt + input.payload` 表达，包含：
  - 动作标识 `meeting_monitor`
  - 超时阈值（warning/end）
  - 提醒与结束消息模板

对应文件：
- `backend/src/modules/orchestration/scheduler/scheduler.service.ts`

### 2.3 历史计划兼容迁移

- 在 `ensureMeetingMonitorSchedule()` 中加入幂等修正：
  - 若 `system-meeting-monitor` 已存在，自动更新为新 input 结构
  - 同步刷新 interval 配置，避免旧配置残留

对应文件：
- `backend/src/modules/orchestration/scheduler/scheduler.service.ts`

## 3. 文档更新

- 更新会议功能文档，明确会议监控由 Scheduler 触发、Orchestration 执行。
- 在相关文档索引中补充本次计划与开发总结链接。

对应文件：
- `docs/features/MEETING_CHAT.md`
- `docs/plan/MEETING_ASSISTANT_LOG_SESSION_FIX_PLAN.md`

## 4. 验证结果

- `backend` 构建通过：`npm run build`。
- `backend` lint 无法执行：仓库当前缺少 ESLint 配置文件（环境/仓库现状，非本次改动引入）。

## 5. 效果与收益

- Scheduler 与 Orchestration 分层边界更清晰：前者负责触发，后者负责执行。
- 会议监控执行可自动继承统一的 agent runtime、session、action log 链路。
- 为后续“更多系统定时能力编排化”提供可复用模板。

## 6. 风险与后续建议

- `meeting-assistant` 需与可执行 agent 身份持续一致，否则会触发调度任务失败。
- 建议在后续补充针对 `system-meeting-monitor` 的集成测试，验证 task/session/action_log 三链路联通。
- 建议为系统内置 schedule 的迁移增加版本标识，便于未来演进与回滚。
