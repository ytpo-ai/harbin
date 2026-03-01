# 会议模型列表查询修复开发总结

## 背景

会议中用户提问“现在系统里有哪些模型？”时，`Model Management Agent` 返回了 Agent 列表（如 Alex/Kim），而不是系统模型列表。该问题属于意图路由与工具使用约束不足。

## 本次实现

1. 新增模型列表 MCP 工具 `model_mcp_list_models`
   - 位置：`backend/apps/agents/src/modules/tools/tool.service.ts`
   - 能力：读取系统当前模型库，支持 `provider` 与 `limit` 参数
   - 输出：`id/name/provider/model/maxTokens/temperature/topP`

2. 模型管理 Agent 工具集与提示词强化
   - 位置：`backend/apps/agents/src/modules/agents/agent.service.ts`
   - 调整：`MODEL_MANAGEMENT_AGENT_TOOLS` 增加 `model_mcp_list_models`
   - 约束：当用户询问模型列表时，必须先调用 `model_mcp_list_models`

3. 会议意图路由增强
   - 位置：`backend/src/modules/meetings/meeting.service.ts`
   - 新增：`isModelListIntent`、`isModelManagementIntent`
   - 行为：命中“模型列表”或“最新模型搜索”时，优先路由 `Model Management Agent`

4. 会议上下文约束补充
   - 位置：`backend/src/modules/meetings/meeting.service.ts`
   - 规则：模型列表场景必须返回模型字段结构，禁止回答 Agent 列表

5. 文档更新
   - `docs/api/API.md`：补充 `model_mcp_list_models` 能力、会议模型列表特例与调用示例
   - `README.md`：补充工具清单、工具 API 列表、会议模型列表行为说明

## 关键修复点

- 从“依赖模型自由回答”改为“模型列表问题必须工具驱动返回”。
- 通过会议意图路由缩小响应范围，避免无关 Agent 抢答导致答案跑偏。
- 在 Agent 提示词与会议上下文双侧加约束，降低回归概率。

## 验证

- 编译验证通过：
  - `npm run build`
  - `npm run build:agents`

- 预期行为：
  - 会议提问“现在系统里有哪些模型？”时，优先由 `Model Management Agent` 响应。
  - 返回内容为模型清单，不再出现 Agent 角色/能力描述。

## 后续建议

- 为会议意图路由增加单元测试（模型列表、最新模型搜索、普通问答三类）。
- 为工具调用链增加集成测试，覆盖“工具缺失/调用失败/空结果”的降级路径。
