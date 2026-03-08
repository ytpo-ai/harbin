# Agent Remove Type Keep Role 开发总结

## 背景

- Agent 领域同时维护 `type` 与 `roleId`，在身份表达与默认配置上存在重复。
- 本次改造目标：以角色为主（role-first），前端移除类型输入，后端改为兼容历史 `type` 但不再强依赖。

## 实施内容

1. 后端契约兼容化（不再强依赖 `type`）
   - Agent schema 的 `type` 调整为可选：`backend/src/shared/schemas/agent.schema.ts`。
   - 共享类型同步为可选：`backend/src/shared/types.ts`、`frontend/src/types/index.ts`。
   - 创建 Agent 时移除 `type` 必填校验；更新 Agent 时允许清空 `type`：`backend/apps/agents/src/modules/agents/agent.service.ts`。

2. MCP/工具权限映射改为角色优先
   - MCP profile 匹配 key 统一改为优先 `role.code`，`type` 仅兜底。
   - `getMcpAgents/getMcpAgent/buildToolSummaryMap` 等路径完成 role-first 映射。
   - 保持历史数据兼容，不强制迁移旧 `type`。

3. 前端 Agent 管理页去类型化
   - 创建/编辑表单移除“类型”字段与校验，仅保留“角色”。
   - 角色切换时，默认 Prompt 来源改为 `role.promptTemplate`，并沿用“仅在未手改时自动覆盖”的策略。
   - 创始人识别逻辑从 `agent.type` 改为 `role.code` 优先。
   - 主要改动：`frontend/src/pages/Agents.tsx`。

4. 展示文案与相关页面调整
   - Agent 详情、讨论、会议页面从“类型”展示切换为“角色（roleId）”展示：
     - `frontend/src/pages/AgentDetail.tsx`
     - `frontend/src/pages/Discussions.tsx`
     - `frontend/src/pages/Meetings.tsx`
   - HR 页面同步按钮文案调整为“系统角色模板”语义：`frontend/src/pages/HRManagement.tsx`。

5. Memo 与功能文档同步
   - Identity 聚合内容改为“角色ID + 历史类型”：`backend/apps/agents/src/modules/memos/identity-aggregation.service.ts`。
   - 功能文档描述同步：`docs/features/AGENT_MEMO.md`。
   - 计划文档：`docs/plan/AGENT_REMOVE_TYPE_KEEP_ROLE_PLAN.md`。

## 验证

- `frontend/` 执行 `npm run build` 通过。
- `backend/` 执行 `npm run build:agents` 通过。

## 风险与后续建议

- 当前部分展示仍使用 `roleId` 直接显示，后续可统一为 `role.name`（需补充角色映射查询）。
- 历史 `type` 字段仍保留用于兼容，建议在二阶段完成全链路清理后再做物理删字段。
