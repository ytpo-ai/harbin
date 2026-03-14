# OpenCode SDK Removal API Direct Call Plan

## 1. 背景与目标

- 后端当前依赖 `@opencode-ai/sdk`，在动态导入、导出形态兼容、运行时稳定性方面存在较多问题。
- 本次改造目标是移除 SDK 依赖，改为通过稳定的 HTTP 接口直连 OpenCode 服务。
- 保持现有业务语义不变：会话创建、Prompt 调用、事件订阅、项目/会话查询、健康检查与错误处理行为保持兼容。

## 2. 执行步骤

1. 梳理 SDK 使用点：盘点 `backend/apps/agents` 与 `backend/src/modules/rd-management` 中所有 SDK 入口和调用路径。
2. 设计统一 API 访问层：封装 baseUrl 归一化、Basic Auth、超时、响应解包、错误映射和脱敏日志。
3. 替换 Runtime OpenCode 适配器：将 `OpenCodeAdapter` 的 `createSession/promptSession/subscribeEvents` 改为直连 HTTP。
4. 替换 RD 管理 OpenCode 服务：移除 SDK 初始化与 client 分支逻辑，统一走 HTTP 接口并保留回退能力（按 endpoint 切换）。
5. 清理依赖与兼容提示：移除与 SDK 相关的导入、报错文案和冗余 fallback 代码，确保错误信息聚焦在 API 连通性。
6. 完成验证与文档同步：执行后端 lint/类型检查，补充功能文档与日常记录中对“SDK 移除”的说明。

## 3. 关键影响点

- 后端：`agents` runtime 的 OpenCode 执行适配层；`rd-management` 的 OpenCode 集成层。
- API：OpenCode `/session`、`/session/:id/prompt`、`/session/:id/message`、`/project`、`/event`、`/health` 等接口调用。
- 稳定性：减少 SDK 导入失败、导出结构变动带来的线上不可用风险。
- 观测性：错误日志从“SDK 初始化失败”转为“接口请求失败”，便于按 endpoint 排障。

## 4. 风险与依赖

- 依赖 OpenCode HTTP API 的字段稳定性；若接口返回结构变化，需要同步更新响应映射。
- SSE/事件流接口在不同环境的连接保持策略可能不同，需要验证长连接稳定性。
- 若 SDK 曾做隐式字段补全，需在服务端适配层显式补齐，避免行为漂移。

## 5. 完成标准

- 后端不再依赖 `@opencode-ai/sdk` 进行 OpenCode 能力调用。
- Runtime 与 RD 管理链路在不改调用方的前提下可正常创建会话、发送 prompt、查询项目/会话、读取事件。
- 关键异常场景（鉴权失败、超时、目标服务不可达）有稳定错误输出和可定位日志。
