# Scheduler 编排统一化优化计划（会议监控场景）

## 概述

将 `OrchestrationScheduler` 从“调度 + 业务执行”重构为“调度触发器”，执行能力统一收敛到 `OrchestrationPlan/Task` 链路。以 `system-meeting-monitor` 为首个落地场景，修复“会议助理工作但缺少统一日志与 session”的设计问题。

## 目标架构

- Scheduler：负责 cron/interval/manual 触发、并发锁、运行统计
- Orchestration：负责任务执行、agent runtime、session 生命周期、action log
- Meeting Monitor：作为被触发的编排任务，由 meeting-assistant 通过工具完成检查/提醒/结束

## 执行步骤

### 1. 去除调度器中的业务旁路

- 删除 `system-meeting-monitor` 在 scheduler 中的直接 HTTP 执行逻辑
- 所有 schedule 统一走 `dispatchSchedule -> create task -> executeStandaloneTask`

**影响点**: 后端（scheduler）

### 2. 标准化系统会议监控计划输入

- 在系统内置 `system-meeting-monitor` 中使用 `input.prompt + input.payload`
- 将阈值与固定消息模板作为结构化 payload 传入，供 agent 编排执行使用

**影响点**: 后端（schedule 数据模型）

### 3. 复用 Orchestration 执行链路

- 通过 `OrchestrationService.executeStandaloneTask` 触发 meeting-assistant 执行
- 让 session / action log 由现有 `AgentClientService.executeTaskDetailed` 统一落库

**影响点**: 后端（orchestration、agent runtime 日志链路）

### 4. 增加迁移兼容策略

- 启动时如果已存在 `system-meeting-monitor`，自动修正旧 `input.action` 结构为新结构
- 兼容历史数据并确保 schedule 可持续执行

**影响点**: 后端（系统初始化与运维）

### 5. 测试与验收

- 运行编译检查，确认重构后无类型/构建错误
- 验证 schedule 触发后，存在 task、session、agent_action_logs 的完整链路

**影响点**: 测试、质量保障

## 风险与依赖

- `meeting-assistant` 执行人标识需与实际可执行 agent 保持一致（否则任务会失败）
- 会议监控从“代码内硬逻辑”迁移到“agent 执行逻辑”后，结果稳定性依赖提示词与工具可用性
- 历史 schedule 数据若长期未重启迁移，可能仍保留旧 input 结构

## 状态

- [x] 待开发
- [x] 开发中
- [x] 待测试
- [x] 完成
