# 研发 Agent 双 Runtime 路由恢复计划

## 1. 背景与目标

- 背景：此前为让研发 Agent 更聚焦 OpenCode 开发，执行链路被收敛为 OpenCode 通道，导致其“项目内部 runtime（native）”常规能力退化。
- 目标：恢复研发 Agent 的双通道执行能力，根据任务类型自动选择执行 runtime（`opencode` 或 `native`），并保持现有 OpenCode endpoint 优先级与运行时可观测性。

## 2. 执行步骤

1. 盘点当前执行门禁与通道路由逻辑，定位“仅 OpenCode 可执行”的硬编码与判定入口（Agent execute / Agent Task Worker / Orchestration 透传上下文）。
2. 在 Agent 执行上下文中补齐任务类型线索（优先显式字段，其次 sessionContext/source/task.type），建立统一 `runtimeChannel` 判定函数。
3. 调整 OpenCode 配置解析策略：保留 `provider=opencode` 作为能力声明，但不再等价于“强制全部任务走 opencode”；改为按任务类型命中路由规则。
4. 恢复 native 执行分支的可达性（含非流式与流式），并确保 OpenCode 分支继续遵守 endpoint 优先级：`execution.endpoint > execution.endpointRef > context.opencodeRuntime.endpoint > context.opencodeRuntime.endpointRef > OPENCODE_SERVER_URL`。
5. 增加运行时审计字段与日志：记录最终命中通道、判定来源、任务类型，便于排障与复盘。
6. 补充/更新测试：覆盖任务类型命中 opencode、命中 native、缺省兜底、异步 Agent Task 场景，确保终态与 SSE 行为一致。
7. 完成功能与开发文档同步（feature/development/dailylog），确保规则可追踪。

## 3. 关键影响点

- 后端（Agents Runtime）：`backend/apps/agents/src/modules/agents/` 执行路由与策略判定。
- 后端（Agent Task）：`backend/apps/agents/src/modules/agent-tasks/` 上下文透传与异步执行入口。
- 后端（Orchestration -> Agents）：`backend/src/modules/orchestration/` 发起 async agent task 时的任务类型上下文。
- 可观测：run 的 `executionChannel`、执行日志与事件 payload 增加判定元信息。
- 文档：`docs/feature/AGENT_RUNTIME.md`、相关开发沉淀与 dailylog。

## 4. 风险与依赖

- 任务类型输入不规范可能导致路由误判；需采用“显式优先 + 安全兜底 + 可观测日志”策略。
- 若历史链路未透传任务类型，将回落默认策略（建议默认 `native`，仅研发编码类任务走 `opencode`）。
- 需保证不破坏既有 OpenCode 鉴权与 endpoint 解析规则，避免引入回退错配问题。
