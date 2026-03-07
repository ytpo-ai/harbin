# 会议编排执行主计划（开发沉淀）

## 关联主文档索引

- 计划主文档：`docs/plan/MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md`
- 技术实现细节：`docs/technical/MEETING_ORCHESTRATION_EXECUTION_TECHNICAL.md`（中文）
- 相关架构：`docs/architecture/AGENT_ORCHESTRATION_ARCHITECTURE_DESIGN.md`
- 相关时序：`docs/architecture/AGENT_ORCHESTRATION_SEQUENCE_DIAGRAMS.md`

## 范围

聚合沉淀：

- `docs/plan/MEETING_ORCHESTRATION_MCP_PLAN.md`
- `docs/plan/MEETING_ORCHESTRATION_FORCED_TOOLCALL_PLAN.md`
- `docs/plan/MEETING_ORCHESTRATION_PENDING_INTENT_PLAN.md`

## 已完成实现

1. 会议场景 `orchestration_*` MCP 工具接入（create/run/get/list/reassign/complete-human）。
2. ToolService 支持会议上下文识别与服务间签名调用 orchestration API。
3. 编排高风险动作要求 `confirm=true`。
4. Agent 执行链路支持会议上下文透传到工具执行。
5. 增加编排意图强制分支：会议中命中意图时直接触发工具调用。
6. 增加短确认词续接：用户回复“执行/继续/开始”可自动补全 run plan。
7. 会议消息包装归一化：从 `[新消息] ...` 包装文本中提取真实指令再做意图识别。
8. 组织上下文兜底：meeting/tool 双侧补齐 `organizationId` 解析路径。

## 关键文件

- `backend/apps/agents/src/modules/tools/tool.service.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`
- `backend/src/modules/meetings/meeting.service.ts`
- `backend/src/modules/orchestration/orchestration.controller.ts`

## 实现细节迁移说明

本开发沉淀保留"范围、结果、问题与改进"视角；调用链、判定逻辑、失败模式与参数约束等实现细节已迁移至：

- `docs/technical/MEETING_ORCHESTRATION_EXECUTION_TECHNICAL.md`（中文技术设计文档）

## 线上问题与对应修复

- 现象：Agent 只回复“我无法执行”但不调工具。
  - 修复：新增会议编排强制调用分支。
- 现象：创建计划成功后回复“执行”无效。
  - 修复：短确认词 + 最近 planId 回溯补全。
- 现象：提示 `Missing organization context`。
  - 修复：meeting/tool 双侧补充组织上下文兜底解析。

## 后续建议

1. 将最近 `planId` 升级为显式 pendingAction 状态（建议 Redis），替代纯消息回溯。
2. 增加前端可视化标记（本轮是否触发强制分支、使用的 toolId、planId）。
