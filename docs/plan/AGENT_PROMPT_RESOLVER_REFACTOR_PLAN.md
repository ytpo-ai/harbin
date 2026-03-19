# Agent Prompt Resolver 收敛计划

> 状态：进行中
> 更新时间：2026-03-18

## 1. 需求目标

将 `backend/apps/agents/src/modules/agents/agent.service.ts` 内分散的 Prompt 文案统一下沉到独立文件，形成可检索的 Prompt 元数据清单（`symbol/context/scene/role/defaultContent`），并在 Agent 侧直接使用模板默认值（不通过 `promptResolver.resolve` 覆盖 Agent prompt）。

## 2. 执行步骤

1. **新增 Prompt 目录文件**
   - 新增 `agent-prompts.ts`，集中维护 Agent 运行链路涉及的 Prompt 清单。
   - 对动态 Prompt 提供模板构造函数，避免业务代码内拼接硬编码文案。

2. **AgentService 接入统一模板渲染**
   - 在 `agent.service.ts` 增加统一的 Prompt 模板渲染方法。
   - 将创建 Agent、连接测试、工具注入、工具失败重试、会议兜底等文案切换为模板渲染读取。

3. **保留会议上下文能力**
   - 会议执行策略 Prompt 继续纳入统一模板清单。
   - 兼容现有 `system context block` 去重与 fingerprint 机制。

4. **文档与记录同步**
   - 更新功能文档中 Agent Runtime 的 Prompt 组织方式说明。
   - 同步当日 `dailylog` 记录改造内容与影响范围。

## 3. 关键影响点

- 后端：`agent.service.ts` Prompt 获取流程、工具注入提示、会议重试与兜底提示。
- Prompt Registry：本次不接入 Agent prompt 运行时覆盖，避免 Agent prompt 来源分叉。
- 文档：`docs/feature/AGENT_RUNTIME.md`、`docs/dailylog/day/2026-03-18.md`。

## 4. 风险与约束

- 新增 scene/role 必须稳定命名，避免后续数据库模板“同义重复”。
- 动态模板需保证变量替换稳定，避免将占位符原样输出给最终用户。
- 会议场景 fallback 逻辑不能因改造而改变行为（仍需保证空回复兜底）。
