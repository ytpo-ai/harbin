# 会议编排 Pending Intent 补全计划

## 背景

当前会议编排触发主要依赖单轮关键词和显式参数。当 Agent 返回“请回复执行”后，用户仅回复“执行”时，系统无法自动关联上一轮 `planId`，导致回退到普通对话。

## 执行步骤

1. 在会议编排意图识别中加入“短确认词”识别（如：执行/继续/开始/run）。
2. 当短确认词命中且当前消息未携带 `planId` 时，从会话最近消息中回溯提取最近 `planId`。
3. 若回溯到 `planId`，自动补全并触发 `orchestration_run_plan(confirm=true)`。
4. 增加日志，标记“short_confirm + recovered_plan_id”路径，便于排障。
5. 构建验证 agents 服务，确保改动可编译。

## 关键影响点

- 后端：`backend/apps/agents/src/modules/agents/agent.service.ts`

## 风险与依赖

- 风险：短词误触发。
  - 缓解：仅在会议上下文 + 存在可回溯 `planId` + 分配了 `orchestration_run_plan` 工具时触发。
