# 会议场景触发模型管理 Agent 计划

> 状态：已并入统一主计划 `docs/plan/MEETING_CAPABILITY_MASTER_PLAN.md`，本文件保留历史细节。

## 需求理解

- 在会议中，当用户输入“搜索最新openai模型”等指令时，`Model Management Agent` 需要联网搜索并返回结果。
- 返回结果后，Agent 需要主动询问是否将候选模型添加到系统。
- 在用户明确确认前，不应自动写入系统模型库。

## 执行步骤

1. 梳理会议消息触发到 Agent 响应的链路，定位可插入意图路由与优先响应逻辑的位置。
2. 新增会议意图识别规则（中英文关键词），识别“搜索最新 OpenAI 模型”类请求。
3. 在命中该意图时优先路由 `Model Management Agent` 响应，避免无关 Agent 抢答。
4. 强化 `Model Management Agent` 的系统提示词与工具调用约束：先搜索、返回候选、询问确认，不确认不入库。
5. 更新 API/README 会议场景说明并完成构建验证。

## 关键影响点

- 后端：`meetings` 模块消息路由逻辑。
- Agent：`Model Management Agent` 提示词与默认行为约束。
- 工具链：`model_mcp_search_latest` 与 `model_mcp_add_model` 的调用顺序约束。
- 文档：会议场景触发说明。

## 风险与依赖

- 关键词误判可能导致误路由，需要保守匹配策略。
- 会议中若未加入 `Model Management Agent`，需降级回原有响应机制。
- 联网搜索依赖外部服务可用性（Composio/API 配置）。

## 验证方式

- 在会议中发送“搜索最新openai模型”，应由 `Model Management Agent` 响应搜索结果。
- 响应末尾应明确询问“是否需要添加到系统”。
- 未收到用户确认前，不触发 `model_mcp_add_model` 写入。
