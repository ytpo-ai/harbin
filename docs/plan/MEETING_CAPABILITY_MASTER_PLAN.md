# 会议能力统一计划（合并版）

## 目标

将会议相关的分散计划统一收敛到单一主计划，形成“一个入口 + 多专题子项”的可追踪结构，减少重复维护与状态分裂。

## 范围

本合并覆盖以下会议能力专题：

1. 会议/聊天体验升级
   - 来源：`docs/plan/MEETING_CHAT_UPGRADE_PLAN.md`
2. 参会人上下文同步
   - 来源：`docs/plan/MEETING_PARTICIPANTS_CONTEXT_SYNC_PLAN.md`
3. 人类专属助理会议接入
   - 来源：`docs/plan/HUMAN_EXCLUSIVE_ASSISTANT_MEETING_PLAN.md`
4. 会议场景模型管理触发
   - 来源：`docs/plan/MEETING_MODEL_MANAGEMENT_TRIGGER_PLAN.md`
5. 模型列表查询路由修复
   - 来源：`docs/plan/MODEL_LIST_QUERY_ROUTING_PLAN.md`
6. 工具调用解析鲁棒性（会议相关）
   - 来源：`docs/plan/TOOL_CALL_PARSER_ROBUSTNESS_PLAN.md`
7. Agent 一对一聊天入口
   - 来源：`docs/plan/AGENT_ONE_ON_ONE_CHAT_ENTRY_PLAN.md`

## 当前统一状态

- 聊天与页面体验能力：已完成
- 参会人上下文同步：已完成
- 专属助理会议机制：已完成（含多轮增补）
- 模型管理 Agent 触发与模型列表查询路由：已完成
- 工具调用解析鲁棒性增强：已完成
- Agent 一对一聊天入口：已完成

## 统一执行策略（后续）

1. 新增会议需求统一落在本文件，按“专题小节”追加，不再新增同类分散 plan。
2. 原专题文档保留为历史明细，仅做补充证据与实现细节，不再作为状态主入口。
3. 状态维护以本文件为准：`待做 / 进行中 / 已完成 / 风险跟踪`。
4. 与开发总结联动：对应沉淀到 `docs/development/MEETING_CAPABILITY_MASTER_PLAN.md`。

## 关键影响点

- 后端：`meetings` 模块、部分 `agents/tools` 会议路由能力
- 前端：`Meetings` 页面、Agent 入口聊天跳转、WS 状态同步
- 文档：API、README、plan/development 双目录同步

## 风险与依赖

- 会议能力跨前后端与实时链路，变更需同步验证 HTTP + WS 一致性。
- 会议意图路由与工具调用策略演进时，需避免对普通会话造成误路由。
- 专属助理规则与历史数据兼容仍需持续巡检。

## 备注

- 本文档为会议计划总入口。
- 历史专题 plan 文档保留，不删除。
