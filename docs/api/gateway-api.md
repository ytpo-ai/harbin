# Gateway API

## 基础信息

- 对外入口：`http://localhost:3100/api`
- 服务角色：统一入口、鉴权透传、路由分发、操作日志
- 实现位置：`backend/apps/gateway/src/gateway-proxy.service.ts`

## 路由分发（当前）

- `/api/engineering-intelligence/**` -> Engineering Intelligence 服务（3004）
- `/api/agents/**` -> Agents 服务（3002）
- `/api/tools/**` -> Agents 服务（3002）
- `/api/skills/**` -> Agents 服务（3002）
- `/api/models/**` -> Agents 服务（3002）
- `/api/model-management/**` -> Agents 服务（3002）
- `/api/agent-action-logs/**` -> Agents 服务（3002）
- 其他 `/api/**` -> Legacy 服务（3001）

## 内部安全头

Gateway 会向下游服务附加：

- `x-user-context`: `base64url(JSON(userContext))`
- `x-user-signature`: `HMAC_SHA256(x-user-context, INTERNAL_CONTEXT_SECRET)`

下游服务应只信任签名后的上下文头。

## 注意事项

- 业务接口定义见各服务文档，不在 Gateway 文档重复维护。
- 若新增服务或路由，需同时更新本文件与 `docs/architecture/MICROSERVICES_MIGRATION.md`。
