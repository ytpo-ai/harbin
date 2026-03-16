# Agent Execute Identifier Compat Plan

## Goal
修复 `POST /api/agents/:agentId/execute` 在传入业务标识（如 `executive-lead`）时触发 `ObjectId` 转换异常的问题，支持 `_id` 与业务标识双通道查询并返回正确的业务错误码。

## Steps
1. 定位 `agents/:agentId/execute` 的参数传递与 Agent 查询链路，确认 `_id` 强制查询入口。
2. 在 Agent 查询层增加标识兼容解析：`ObjectId` 走 `_id`，非 `ObjectId` 走业务唯一字段。
3. 统一 `execute` 链路的 Agent 获取逻辑，避免重复实现与 CastError 外抛。
4. 将“未找到 Agent”统一收敛为 404 业务异常，并补充清晰错误信息。
5. 补充/更新测试，覆盖 ObjectId 与业务标识两种入参场景。
6. 执行 lint/typecheck/相关测试，确认修复无回归。

## Impact
- Backend API (`/api/agents/:agentId/execute`) 参数兼容性与错误语义
- Agent 查询逻辑与测试用例

## Risks
- 需确认 Agent 模型中用于业务标识查询的唯一字段，避免歧义命中。
- 若业务标识缺少唯一索引，可能出现多条命中风险（需以唯一字段约束规避）。
