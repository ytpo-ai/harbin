# Agent Debug Timing Provider 改造计划

## 背景

- `agents` app 中存在多处 `debugTiming` 私有实现，开关读取、日志拼接与字段命名分散在不同服务中。
- 当前重复逻辑不利于统一治理，也限制了后续扩展（如采样、统一 trace、上报到观测系统）。
- 本次需求目标是将 `debugTiming` 能力收敛为统一 Provider，并让现有调用全部改为引用该 Provider。

## 实施步骤

1. 在 `backend/libs/common` 新增 `DebugTimingProvider`，统一封装开关读取、耗时计算、日志格式与扩展字段处理。
2. 在 `backend/libs/common/src/index.ts` 暴露 Provider 导出，供 `agents` app 直接复用。
3. 在 `backend/apps/agents/src/modules/runtime/runtime.module.ts` 注册并导出 `DebugTimingProvider`，作为 `agents` 运行时公共依赖。
4. 在 `agent-executor.service.ts` 中移除本地 `debugTiming` 与重复开关逻辑，改为注入 `DebugTimingProvider` 调用。
5. 在 `runtime-orchestrator.service.ts` 中移除本地 `debugTiming`，改为注入 `DebugTimingProvider` 调用，统一日志入口。
6. 补充 `docs/guide/` 的结构化说明，沉淀 debug timing 的接入位置、调用规范与后续扩展方向。
7. 更新 `docs/feature/AGENT_RUNTIME.md` 的能力说明，反映 `debugTiming` 已统一 Provider 化。

## 关键影响点

- 后端：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`
- 后端：`backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`
- 公共库：`backend/libs/common/src/`
- 模块装配：`backend/apps/agents/src/modules/runtime/runtime.module.ts`
- 文档：`docs/guide/`、`docs/feature/AGENT_RUNTIME.md`

## 风险与依赖

- `debugTiming` 统一后会由同一开关控制，若线上依赖原有“局部始终输出”行为，日志量可能变化。
- Provider 放在 `libs/common` 后需避免引入业务依赖，保持仅包含通用调试能力。
- 后续若扩展到指标上报，需确认上报通道与采样策略，避免高频日志影响性能。
