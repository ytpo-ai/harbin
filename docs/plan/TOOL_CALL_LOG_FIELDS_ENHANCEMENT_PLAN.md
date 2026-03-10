# Tool Call Log Fields Enhancement Plan

## Goal
在任务执行过程中补齐工具调用日志字段，确保系统进程日志与任务 agent 日志都可查看 `toolName`、`toolId`、`params`。

## Scope
- Backend runtime / orchestration logging pipeline
- System process logs（runtime hook -> action logs）
- Task agent logs（task/run 维度日志）
- API 返回结构与兼容处理

## Steps
1. 梳理现有工具调用事件与两类日志落库链路，确认字段缺口与复用点。
2. 在工具事件载荷中统一补充 `toolName`、`toolId`、`params`，并对敏感字段执行脱敏。
3. 将新增字段同步写入系统进程日志，覆盖 `tool.pending/running/completed/failed`。
4. 将新增字段同步写入任务 agent 日志，确保按 task/run 查询时字段一致。
5. 调整日志查询 DTO/返回映射，对历史数据缺字段场景保持兼容。
6. 补充测试并执行 lint/typecheck，验证成功与失败路径的日志完整性。
7. 更新功能/API 文档，说明新增日志字段与兼容策略。

## Impacts
- Backend runtime modules
- Agent action log / orchestration task logging
- Logs query APIs and frontend consumers

## Risks/Dependencies
- `params` 可能包含敏感信息，需脱敏后再写入日志。
- `params` 可能较大，需控制大小避免日志膨胀。
- 历史日志不含新字段，查询与前端展示需兼容空值。
