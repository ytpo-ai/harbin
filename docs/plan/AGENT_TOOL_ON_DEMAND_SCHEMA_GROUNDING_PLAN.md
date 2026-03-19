# Agent 工具按需 Schema Grounding 计划

## 背景

- 当前 Agent 运行时仅注入工具 `id/name/description`，缺少参数契约的按需注入，导致模型在工具入参上依赖猜测与失败重试。
- 在工具数量增长后，若将全部参数定义写入上下文，会放大 prompt 体积并稀释任务有效信息。

## 实施步骤

1. 在 `ToolService` 增加“工具参数契约归一化”能力：将 `inputSchema` 与 `implementation.parameters` 统一为可消费的 JSON Schema 视图（`properties/required/additionalProperties`）。
2. 保持运行时默认工具注入为轻量目录（`id/name/description`），不做全量参数结构注入，控制上下文体积。
3. 在 Agent 工具调用失败分支中，针对参数类错误触发“单工具按需 grounding”，仅回填当前失败工具的参数契约并要求立即重试。
4. 将 `send-internal-message` 工具定义升级为标准 JSON Schema（含 `required`），让参数约束来自工具定义本身而非硬编码提示。
5. 增加/更新测试覆盖：验证参数错误时触发按需 schema 修正提示；验证 send-internal-message 的 schema 约束可被运行时消费。
6. 更新功能文档与当日日志，记录“按需 schema grounding”策略与影响范围。

## 关键影响点

- 后端（agents runtime）：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`
- 后端（tools）：`backend/apps/agents/src/modules/tools/tool.service.ts`、`backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`
- 文档：`docs/feature/AGENT_TOOL.md`、`docs/dailylog/day/2026-03-19.md`

## 风险与依赖

- 历史工具数据中可能存在非标准 schema，需要归一化兜底避免按需提示失效。
- 参数错误识别策略若过宽，可能在非参数错误场景误触发 grounding；需收敛到输入校验/必填缺失类错误。
