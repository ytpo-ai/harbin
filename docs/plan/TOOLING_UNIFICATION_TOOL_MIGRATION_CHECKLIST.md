# 工具系统统一化存量迁移清单

> 状态：执行中
> 更新时间：2026-03-08

## 1. 使用说明

- 本清单用于跟踪“当前工具 -> 新统一模型”的全量改造进度。
- 迁移完成判定：`newToolId` 已生效、调用方已切换、回归通过、旧入口下线。
- 状态枚举：`pending` | `in_progress` | `completed` | `accepted_exception`。

## 2. 存量工具映射总表

| domain | sourceType | oldToolId | newToolId | owner | status | notes |
|------|------|------|------|------|------|------|
| web | internal-tool | `websearch` | `internal.web.search` | tools-backend | in_progress | 已落盘映射，待 schema 统一 |
| web | internal-tool | `webfetch` | `internal.web.fetch` | tools-backend | in_progress | 已落盘映射，待返回结构统一 |
| content | internal-tool | `content_extract` | `internal.content.extract` | tools-backend | in_progress | 已落盘映射，待参数校验升级 |
| composio | composio-wrapper | `slack` | `composio.slack.sendMessage` | tools-backend | in_progress | 当前封装调用 `SLACK_SEND_MESSAGE` |
| composio | composio-wrapper | `gmail` | `composio.gmail.sendEmail` | tools-backend | in_progress | 当前封装调用 `GMAIL_SEND_EMAIL`/`GMAIL_CREATE_EMAIL_DRAFT` |
| repo | internal-tool | `repo-read` | `internal.repo.read` | tools-backend | in_progress | 待执行治理策略接入 |
| docs | mcp-tool | `gh-repo-docs-reader-mcp` | `mcp.docs.summary` | tools-backend | in_progress | 与本地 docs reader 语义需收敛 |
| updates | mcp-tool | `gh-repo-updates-mcp` | `mcp.updates.summary` | tools-backend | in_progress | 待错误码统一 |
| docs | internal-tool | `local-repo-docs-reader` | `internal.docs.read` | tools-backend | in_progress | 与 mcp.docs 关系待明确 |
| updates | internal-tool | `local-repo-updates-reader` | `internal.updates.read` | tools-backend | in_progress | 与 mcp.updates 关系待明确 |
| agents | internal-tool | `agents_mcp_list` | `internal.agents.list` | tools-backend | in_progress | 与 profile 可见性联动 |
| model | mcp-tool | `model_mcp_list_models` | `mcp.model.list` | tools-backend | in_progress | 返回字段统一 |
| model | mcp-tool | `model_mcp_search_latest` | `mcp.model.searchLatest` | tools-backend | in_progress | 错误码统一 |
| model | mcp-tool | `model_mcp_add_model` | `mcp.model.add` | tools-backend | in_progress | 高风险动作确认 |
| memo | internal-tool | `memo_mcp_search` | `internal.memo.search` | tools-backend | in_progress | 入参 schema 标准化 |
| memo | internal-tool | `memo_mcp_append` | `internal.memo.append` | tools-backend | in_progress | 输出结构归一化 |
| log | mcp-tool | `human_operation_log_mcp_list` | `mcp.humanOperationLog.list` | tools-backend | in_progress | 审计字段补齐 |
| orchestration | mcp-tool | `orchestration_create_plan` | `mcp.orchestration.createPlan` | tools-backend | in_progress | 会议上下文约束 |
| orchestration | mcp-tool | `orchestration_run_plan` | `mcp.orchestration.runPlan` | tools-backend | in_progress | confirm=true 强校验 |
| orchestration | mcp-tool | `orchestration_get_plan` | `mcp.orchestration.getPlan` | tools-backend | in_progress | ID 解析统一 |
| orchestration | mcp-tool | `orchestration_list_plans` | `mcp.orchestration.listPlans` | tools-backend | in_progress | 分页协议统一 |
| orchestration | mcp-tool | `orchestration_reassign_task` | `mcp.orchestration.reassignTask` | tools-backend | in_progress | 高风险动作确认 |
| orchestration | mcp-tool | `orchestration_complete_human_task` | `mcp.orchestration.completeHumanTask` | tools-backend | in_progress | 高风险动作确认 |

## 3. 调用方迁移清单

| caller | migrationTask | status | notes |
|------|------|------|------|
| `/tools/:id/execute` API | 接入新执行器并返回 `resolvedToolId` | in_progress | 已返回 `requestedToolId/resolvedToolId/resolvedLegacyToolId` |
| Agent Runtime | 工具调用改走新 Router/Executor | in_progress | 已切 canonical toolId 与统一结果解包，待回归 tool event |
| Agent 工具白名单 | 白名单从旧 id 切到新 id | in_progress | Profile 读写已 canonical 化，待历史数据批量清洗 |
| 前端工具管理页 | 展示与搜索改用 Registry 查询接口 | in_progress | 后端已提供 `/tools/registry` |
| 审计与统计 | 指标与日志按新 `toolId` 聚合 | in_progress | history/stats 已输出统一 `toolId`，待告警面板迁移 |

## 4. 下线清单

| item | condition | status |
|------|------|------|
| 旧工具注册入口 | 全量工具迁移完成，新增只走 Adapter | pending |
| 旧执行分支 | 回归通过，域级调用量归零 | pending |
| alias 映射开关 | 连续 1 天 alias 命中 0 后关闭 | in_progress |
| 旧错误结构 | 所有调用方已适配新错误码 | pending |

## 5. 验收记录

- 功能回归：待补充
- 权限回归：待补充
- 安全回归：待补充
- 性能回归：待补充
- 观测验收：待补充

补充说明：

- 已提供 `GET /tools/registry/alias-hits` 观测 alias 命中统计。
- 已提供 `GET /tools/registry/alias-cutoff-readiness?hours=24` 评估 1 天窗口下线就绪状态。
- 已提供 `GET/POST /tools/registry/alias-mapping-status` 读写 alias 开关。
- 已提供 `POST /agents/mcp/migrate-tool-ids` 执行历史数据 canonical 化迁移。
- alias 下线阈值已调整为“连续 1 天命中为 0”。
