# Memo 写入异步化（Redis Queue）方案

## 背景

当前系统内多处 memo 更新逻辑仍为同步执行（运行时、工具调用、任务执行、API 写入路径），会把 memo 持久化时延直接叠加到主业务链路。

## 目标

将系统中的 memo 更新统一改为通过 Redis 消息队列异步执行，业务逻辑只负责投递命令，不再同步执行 memo 写入。

## 执行步骤

1. 盘点 memo 写入入口，收敛为统一 `memo write command` 契约（命令类型 + 幂等键 + 上下文）。
2. 新增 Redis 命令生产/消费链路（队列、去重、重试、死信、结果发布）。
3. 将 runtime/agent/tool/controller 中同步写入调用改为异步投递。
4. 保留读路径同步能力，确保查询接口与运行时读取不受影响。
5. 增加可观测日志与错误隔离，避免队列故障影响主链路。
6. 补充测试与文档，明确“最终一致性”与接口返回语义。

## 关键影响点

- 后端：`backend/apps/agents/src/modules/memos/*`
- 后端：`backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`
- 后端：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`
- 后端：`backend/apps/agents/src/modules/tools/tool.service.ts`
- 后端：`backend/apps/agents/src/modules/memos/memo.controller.ts`

## 风险与应对

- 风险：写后短时间读不到最新 memo（最终一致性窗口）。
  - 应对：写接口返回受理状态与 requestId，必要时提供结果查询。
- 风险：重复消费导致重复写入。
  - 应对：命令幂等键 + 消费去重键。
- 风险：消费失败积压。
  - 应对：重试上限 + 死信队列 + 指标与日志告警。
