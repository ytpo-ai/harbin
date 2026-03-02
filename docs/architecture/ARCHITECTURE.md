# 架构设计文档（微服务现状）

## 系统总览

当前系统为前后端分离 + 后端 Nest Monorepo 多应用架构。

```text
Frontend (React + TS)
        |
        | HTTP / WebSocket
        v
Gateway (3100) ------------------> Engineering Intelligence Service (3201)
   |                                         |
   |                                         v
   |                                   MongoDB / GitHub API
   |
   +------------------------------> Agents Service (3002)
   |                                   |
   |                                   +--> Redis Pub/Sub
   |
   +------------------------------> Legacy Service (3001)
                                       |
                                       +--> MongoDB

WebSocket Service (3003) <------------- Redis Pub/Sub
```

## Monorepo 应用边界

后端应用定义见 `backend/nest-cli.json`，当前包含 5 个应用：

- `legacy`（`backend/src`）
  - 承载尚未拆分的历史业务模块。
  - 端口默认 `3001`，全局前缀 `/api`。
- `gateway`（`backend/apps/gateway`）
  - 统一入口、鉴权、请求签名、路由分发、操作日志落库。
  - 端口默认 `3100`。
- `agents`（`backend/apps/agents`）
  - 承载 Agent/Tools/Models/Skills 等核心执行能力。
  - 端口默认 `3002`，全局前缀 `/api`。
- `ws`（`backend/apps/ws`）
  - WebSocket 网关，订阅 Redis channel 并转发给前端。
  - 端口默认 `3003`，WS 路径 `/ws`（HTTP 服务器上）。
- `engineering-intelligence`（`backend/apps/engineering-intelligence`）
  - 独立承载研发智能文档分析能力。
  - 端口默认 `3201`，全局前缀 `/api`。

## Gateway 分流策略

实现位置：`backend/apps/gateway/src/gateway-proxy.service.ts`

- `/api/engineering-intelligence/**` -> `ENGINEERING_INTELLIGENCE_SERVICE_URL`（默认 `http://localhost:3201`）
- `/api/agents/**` -> `AGENTS_SERVICE_URL`（默认 `http://localhost:3002`）
- `/api/tools/**` -> `AGENTS_SERVICE_URL`
- `/api/skills/**` -> `AGENTS_SERVICE_URL`
- `/api/models/**` -> `AGENTS_SERVICE_URL`
- `/api/model-management/**` -> `AGENTS_SERVICE_URL`
- 其余 `/api/**` -> `LEGACY_SERVICE_URL`（默认 `http://localhost:3001`）

## 服务间安全模型

Gateway 为下游服务附加内部签名上下文：

- `x-user-context`: base64url 编码后的用户上下文
- `x-user-signature`: 基于 `INTERNAL_CONTEXT_SECRET` 的 HMAC 签名

Agents 等下游服务只信任 Gateway 签名上下文，不直接信任前端自带身份头。

## 运行端口与启动方式

默认端口：

- Frontend: `3000`
- Gateway: `3100`
- Agents: `3002`
- WS: `3003`
- Legacy: `3001`
- Engineering Intelligence: `3201`

常用命令（根目录）：

```bash
npm run dev                          # 前端 + 后端主流程
npm run dev:engineering-intelligence # 单独启动研发智能服务
```

后端单服务命令（`backend/package.json`）：

```bash
npm run start:gateway:dev
npm run start:agents:dev
npm run start:ws:dev
npm run start:dev        # legacy
npm run start:ei:dev     # engineering-intelligence
```

## 前端架构入口

前端仍为单应用（`frontend/`），通过路由承载各业务能力（含研发智能页面），未拆分独立前端工程。

主要目录：

- `frontend/src/pages`：页面路由（Agents/Tasks/Meetings/EngineeringIntelligence 等）
- `frontend/src/services`：API 服务封装（含 `engineeringIntelligenceService.ts`）
- `frontend/src/components`：通用 UI 组件
- `frontend/src/stores`：Zustand 状态管理

## 数据与事件通道

- 业务数据主存储：MongoDB（各服务通过 Mongoose 访问）
- 实时事件总线：Redis Pub/Sub
  - Agents/Legacy 发布事件（如会议、讨论、流式输出）
  - WS 服务订阅后推送到前端 channel

## 模块状态说明

- `organization` 与 `governance` 功能模块已在当前版本下线，文档中仅保留历史/迁移语义，不作为当前可用主流程能力。
- 研发智能后端已独立为 `engineering-intelligence` 服务；前端入口保留在主前端应用内。

## 相关文档

- 微服务迁移细节：`docs/architecture/MICROSERVICES_MIGRATION.md`
- 自我进化专题：`docs/architecture/self-evolution/README.md`

---

**架构版本**: v2（微服务迁移态）
**最后更新**: 2026-03-02
