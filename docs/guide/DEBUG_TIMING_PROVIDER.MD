# DEBUG TIMING PROVIDER

## 目标

- 将 `agents` app 中分散的 `debugTiming` 逻辑统一为单一 Provider，避免重复实现。
- 统一耗时日志格式与开关读取方式，降低后续扩展成本。

## 代码位置

- Provider：`backend/libs/common/src/debug-timing.provider.ts`
- 公共导出：`backend/libs/common/src/index.ts`
- 运行时注册：`backend/apps/agents/src/modules/runtime/runtime.module.ts`
- 调用方（当前）：
  - `backend/apps/agents/src/modules/agents/agent-executor.service.ts`
  - `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`

## 当前行为

- 环境开关：`AGENT_DEBUG_TIMING`
- 默认值：`false`
- 日志格式：
  - 前缀固定：`[timing_debug]`
  - 核心字段：`<traceFieldName>=<traceId> stage=<stage> durationMs=<duration>`
  - 附加字段：`extras` 按 `key=value` 展平拼接

## 使用约定

- 统一调用 `DebugTimingProvider.log({...})`，不再在业务服务中重复实现 `debugTiming` 与环境变量解析。
- `traceFieldName` 根据调用语义传入（如 `taskId`、`runOrTaskId`），便于日志检索。
- `startedAt` 使用 `Date.now()` 时间戳，Provider 内统一计算耗时。

## 扩展方向

- 采样控制（按 stage/trace 维度采样）。
- 日志级别策略（debug/info 动态切换）。
- 指标上报（Prometheus/OTel）与 Trace 关联字段扩展。
- 统一脱敏策略（extras 中敏感键过滤）。
