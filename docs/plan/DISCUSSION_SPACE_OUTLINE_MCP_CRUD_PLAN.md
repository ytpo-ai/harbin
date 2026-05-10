# Plan: DISCUSSION_SPACE_OUTLINE_MCP_CRUD_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 需求管理 ID | — |
| 所属项目 | 69f096d658f9498921a8bd27 |
| OpenCode Session | — |
| 状态 | approved |
| 优先级 | high |
| 创建日期 | 2026-05-02 |

## 2. 背景

当前讨论大纲补充依赖通用 Agent Runtime 会话链路，在高管型 Agent（含工具强策略注入）场景下，容易出现“先工具调用/权限检查/阻塞回执”而非直接产出章节补充 JSON。为保障项目 Owner 稳定完成讨论大纲补充，需要将大纲操作能力沉淀为专用 MCP 工具能力。

## 3. 目标

1. 提供讨论大纲 MCP 工具，统一承载大纲增删改查与章节补充操作。
2. 让项目 Owner 在不新增专用 Agent 的前提下，稳定完成大纲补充与维护。
3. 统一动作返回结构与错误语义，避免 runtime chat 行为干扰业务结果。
4. 保留并复用现有 Discussion Outline 业务服务能力，降低改造风险。

## 4. 执行步骤

1. [x] 设计 `discussion outline manage` MCP 工具动作集合与输入输出契约（CRUD + enrich + clear）。
2. [x] 在 agents 工具目录注册工具定义、路由分发与 handler，并打通鉴权与 project/space 边界校验。
3. [x] 在 handler 中复用 `DiscussionOutlineService` 现有能力，统一返回 envelope 和错误码。
4. [x] 为 `enrich_section` 增加严格结果验收（仅接受结构化 entries，拒绝 blocked/澄清回复）。
5. [x] 补充单测与集成验证，覆盖 Owner 场景、权限拒绝、fallback 分支与日志可观测性。
6. [x] 同步更新 feature/requirement/development 追溯文档。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-018 | 新增讨论大纲 MCP 工具并支持章节补充稳定执行 | [链接](../requirement/DISCUSSION_SPACE_REQ-018_OUTLINE_MCP_CRUD.md) | in-review |

## 6. 关键影响点

- **后端**：`backend/apps/agents/src/modules/tools/`、`backend/src/modules/discussions/services/discussion-outline.service.ts`
- **前端**：无直接改动（后续按需接入工具反馈展示）
- **数据库**：无新增集合，复用 `discussion_spaces` 与 `discussion_knowledge_entries`
- **API**：新增 MCP 工具调用入口（通过 tools execute 分发）
- **文档**：plan/requirement/feature/development 追溯链路

## 7. 风险与依赖

- 风险：工具策略与权限白名单配置不一致会导致“可见但不可执行”的运行失败。
- 风险：若不限制返回契约，Owner 仍可能输出合法 JSON 但语义偏离（blocked/澄清）。
- 依赖：现有 tool-dispatch 框架与 `DiscussionOutlineService` 方法稳定可复用。

## 8. 备注

- 不新增专用 Agent，目标是让项目 Owner 通过专用 MCP 动作稳定执行。
- 不引入 `organizationId` 字段。
