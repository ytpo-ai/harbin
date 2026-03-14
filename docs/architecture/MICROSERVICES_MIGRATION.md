# 微服务平滑迁移说明

## 迁移目标

- 前端统一接入 Gateway，避免多后端直连。
- 业务能力按域逐步从 Legacy 拆分到独立服务。
- 通过 Redis + WS 提供统一实时事件通道。
- 在迁移过程中保证兼容与可回滚。

## 当前应用拓扑

- `gateway`（3100）：统一入口、鉴权、签名、转发、操作日志
- `agents`（3002）：Agent/Tools/Models/Skills 核心能力
- `ws`（3003）：WebSocket 推送层（`/ws`）
- `legacy`（3001）：未迁移模块
- `engineering-intelligence`（3004）：研发智能独立后端

## Gateway 路由策略（当前生效）

实现：`backend/apps/gateway/src/gateway-proxy.service.ts`

- `/api/engineering-intelligence/**` -> `ENGINEERING_INTELLIGENCE_SERVICE_URL`
- `/api/agents/**` -> `AGENTS_SERVICE_URL`
- `/api/tools/**` -> `AGENTS_SERVICE_URL`
- `/api/skills/**` -> `AGENTS_SERVICE_URL`
- `/api/models/**` -> `AGENTS_SERVICE_URL`
- `/api/model-management/**` -> `AGENTS_SERVICE_URL`
- `/api/agent-action-logs/**` -> `LEGACY_SERVICE_URL`
- 其他 `/api/**` -> `LEGACY_SERVICE_URL`

## 服务间安全与上下文

Gateway 从登录上下文中提取用户身份并签名透传：

- `x-user-context`: `base64url(JSON(userContext))`
- `x-user-signature`: `HMAC_SHA256(x-user-context, INTERNAL_CONTEXT_SECRET)`

下游服务校验签名，拒绝伪造上下文请求。

## 实时链路（Redis + WS）

1. 前端连接 `ws://localhost:3003/ws`
2. 前端发送 `subscribe` / `unsubscribe` 消息订阅 channel
3. Agents/Legacy 将事件发布到 Redis channel（如 `meeting:<id>`、`stream:<sessionId>`）
4. WS 服务订阅 Redis 并向对应客户端推送
5. WS 推送包中包含 `channel` 字段，支持前端单连接多路复用

## 前端接入现状

- HTTP 统一走 `http://localhost:3100/api`
- Agent 模型测试使用 `test-stream` + WS 流式显示
- Meetings 页面基于 WS 接收消息、状态、总结事件
- 研发智能前端页面集成在主前端路由中，不独立拆前端项目

## 与 Legacy 的关系

- Legacy 继续承载未迁移 API 与业务。
- Gateway 对外屏蔽后端拆分细节，前端无感切换。
- 随迁移推进，路由可按模块逐步切到 Agents 或其他新服务。

## 阶段性边界说明

- 组织管理与公司治理模块当前处于下线状态（待重构），不作为迁移优先目标。
- 研发智能后端已拆分完成，作为独立服务运行。

## 推荐本地启动方式

在 `backend/` 目录按以下顺序启动：

```bash
npm run start:legacy -- --watch
npm run start:agents -- --watch
npm run start:gateway -- --watch
npm run start:ws -- --watch
npm run start:ei -- --watch
```

根目录可用：

```bash
npm run dev
```

说明：`npm run dev` 默认启动前端 + 后端主流程；研发智能服务可按需单独启动。

---

**文档状态**: 与当前代码实现对齐
**最后更新**: 2026-03-02
