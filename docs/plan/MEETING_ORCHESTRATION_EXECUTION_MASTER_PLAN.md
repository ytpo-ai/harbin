# 会议编排执行主计划（聚合）

## 说明

本主计划聚合以下计划文档，统一会议内编排能力建设与可靠性演进：

- `docs/plan/MEETING_ORCHESTRATION_MCP_PLAN.md`
- `docs/plan/MEETING_ORCHESTRATION_FORCED_TOOLCALL_PLAN.md`
- `docs/plan/MEETING_ORCHESTRATION_PENDING_INTENT_PLAN.md`

并纳入同一主题下的补充修复：

- 会议链路组织上下文兜底（`organizationId` 解析）
- 会议消息包装文本归一化（`[新消息] ... 请对此做出回应`）

## 目标

1. 会议中 Agent 可稳定通过 MCP 完成编排闭环（创建/执行/查询/改派/人工回填）。
2. 避免“有工具但不调用”的自然语言空转。
3. 支持短确认词续接（如“执行”）并自动补全必要上下文（planId）。

## 分阶段执行

### 阶段 A：能力接入

- 接入 `orchestration_*` MCP 工具。
- 建立 agents -> legacy orchestration 的签名调用链。
- 高风险动作要求 `confirm=true`。

### 阶段 B：执行可靠性

- 在会议场景增加编排意图识别。
- 命中意图时走确定性强制调用路径（不依赖模型先产出 `<tool_call>`）。
- 增加失败降级提示与日志埋点。

### 阶段 C：会话续接

- 支持短确认词（执行/继续/开始）触发 run plan。
- 从最近会话中回溯 planId 并自动补全。
- 归一化会议包装消息文本，提升意图识别准确率。

### 阶段 D：上下文健壮性

- 在 meeting/tool 双侧补充 `organizationId` 获取兜底。
- 减少跨服务调用中的上下文缺失导致的失败。

## 验收标准

- 会议中“创建计划 -> 回复执行 -> 查询进度”可稳定跑通。
- 日志可观测到强制分支触发（含 reason）。
- 缺失 `planId/taskId` 时返回可操作补参提示，而非泛化拒答。

## 备注

后续若继续扩展会议编排能力（如显式 pendingAction 状态机/Redis 持久化），应在本主计划下递增迭代，避免拆分为新的零散计划文档。
