# Agent Runtime 功能文档沉淀计划

## 背景

`docs/features/INDEX.md` 已将 `agent/agent_runtime` 映射到 `docs/features/AGENT_RUNTIME.md`，但该功能文档当前缺失。需要基于现有 runtime 代码与已沉淀文档，补齐 2 级功能文档，作为后续开发与排障的统一入口。

## 执行步骤

1. 对齐事实来源，优先以 `docs/development/AGENT_RUNTIME_OVERHAUL_PLAN.md`、`docs/api/agents-api.md` 与 runtime 模块代码为准，确定文档边界。
2. 按功能文档规范搭建 `AGENT_RUNTIME.md` 结构：`功能设计`、`相关文档`、`相关代码文件`。
3. 沉淀运行时核心机制：run 生命周期、事件契约、工具状态机、outbox 分发与重试、replay/control plane、死信治理与维护审计。
4. 补充会话与上下文能力说明：session 管理、system message 去重、memoSnapshot 刷新与读写入口。
5. 建立文档引用索引（plan/development/architecture/api），避免重复粘贴实现细节。
6. 更新 `docs/features/INDEX.md` 的 runtime 文档映射清单，确保索引与实际文件一致。

## 影响范围

- 后端：仅文档化现有 runtime 能力，不改动业务逻辑。
- API：梳理并引用现有 runtime 控制与运维接口。
- 文档：新增 `docs/features/AGENT_RUNTIME.md`，补齐 features 索引映射。

## 风险与依赖

- runtime 历史设计与当前实现可能存在偏差，文档以“代码现状 + 已发布文档”作为最终依据。
- 组织隔离等字段在控制面存在预留逻辑，文档需要明确“当前行为”与“设计意图”的边界。
