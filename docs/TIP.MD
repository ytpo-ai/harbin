# TIP（Agent OpenCode Endpoint 优先级）

为避免 Agent 任务错误回退到环境默认地址，OpenCode endpoint 解析必须遵循以下优先级：

1. `agent.config.execution.endpoint`
2. `agent.config.execution.endpointRef`
3. 运行时透传 `context.opencodeRuntime.endpoint`
4. 运行时透传 `context.opencodeRuntime.endpointRef`
5. 环境变量默认 `OPENCODE_SERVER_URL`

## 强约束

- 当 `agent.config.execution.endpoint` 已配置时，禁止被运行时参数或环境变量覆盖。
- 当 `agent.config.execution.endpointRef` 已配置时，仅在 `endpoint` 缺失时生效。
- 只有在以上配置都为空时，才允许回退到 `OPENCODE_SERVER_URL`。

## 排障建议

- 在日志中输出最终解析来源（如 `agent_config_endpoint`、`agent_config_endpoint_ref`、`env_default`）。
- 出现 502/超时时，优先核对“最终命中 endpoint”是否符合本规则。

## 取消任务（OpenCode）约束

- Agent Task 取消 OpenCode 会话时，必须复用本次执行的已解析 runtime endpoint（不可回退到 `OPENCODE_SERVER_URL`）。
- 取消接口固定调用：`POST /session/:id/abort`。
- 为便于核对链路，建议输出：`sessionId + endpoint + abort start/success/failed`。
