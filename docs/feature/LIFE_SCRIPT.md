# Feature: LifeScript 集成（Harbin 视角）

## 1. 功能定位

LifeScript（人生剧本）是 Harbin 平台孵化的独立项目，位于 `workspace/life_script/`。本文档仅覆盖 Harbin 侧的集成改动，LifeScript 自身的功能文档见 [`workspace/life_script/docs/feature/`](../../workspace/life_script/docs/feature/)。

### Harbin 侧集成内容

| 集成点 | 说明 | 涉及模块 |
|--------|------|---------|
| Gateway 路由 | `/api/life-script/*` 与 `/api/auth/issue-redirect-token` 统一代理到 `LIFE_SCRIPT_BASE_URL`（默认 :3101） | Gateway |
| 认证扩展 | redirect-token 签发 + LS token 验证 | Auth / Gateway |
| 前端跳转入口 | Layout 侧边栏 "LifeScript" 外链 | Frontend |

## 2. 需求追溯表

### 2.1 Plan 追溯

| Plan | 说明 | 状态 |
|------|------|------|
| [LIFE_SCRIPT_ADMIN_INTEGRATION](../plan/LIFE_SCRIPT_ADMIN_INTEGRATION.md) | Harbin 侧集成改动 | completed |

### 2.2 Requirement 追溯

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | Gateway 路由扩展 + path rewrite + 跳转入口 | [链接](../requirement/LIFE_SCRIPT_REQ-001_GATEWAY_ROUTING.md) | completed |
| REQ-002 | Redirect-token 签发 + Gateway LS token 验证 | [链接](../requirement/LIFE_SCRIPT_REQ-002_TOKEN_AUTH.md) | completed |

### 2.3 Development 追溯

| 需求 | 开发记录 | 状态 |
|------|----------|------|
| REQ-001 | [LIFE_SCRIPT_REQ-001_DEVELOPMENT](../development/LIFE_SCRIPT_REQ-001_DEVELOPMENT.md) | completed |
| REQ-002 | [LIFE_SCRIPT_REQ-002_DEVELOPMENT](../development/LIFE_SCRIPT_REQ-002_DEVELOPMENT.md) | completed |

## 3. 相关文档

| 类型 | 文档 |
|------|------|
| 技术设计 (Harbin 侧) | [LIFE_SCRIPT_GATEWAY_AUTH_EXTENSION_DESIGN](../technical/LIFE_SCRIPT_GATEWAY_AUTH_EXTENSION_DESIGN.md) |
| 技术设计 (LifeScript 侧) | [`workspace/life_script/docs/technical/LIFE_SCRIPT_ADMIN_INTEGRATION_DESIGN.md`](../../workspace/life_script/docs/technical/LIFE_SCRIPT_ADMIN_INTEGRATION_DESIGN.md) |
| LifeScript Feature 索引 | [`workspace/life_script/docs/feature/INDEX.md`](../../workspace/life_script/docs/feature/INDEX.md) |

## 4. 相关代码

| 文件 | 说明 |
|------|------|
| `backend/apps/gateway/src/gateway-proxy.service.ts` | 路由规则（新增 life-script） |
| `backend/apps/gateway/src/gateway-auth.guard.ts` | 白名单 + LS token 验证 |
| `backend/apps/gateway/src/main.ts` | CORS 配置 |
| `backend/src/modules/auth/auth.controller.ts` | redirect-token 签发接口 |
| `backend/src/modules/auth/auth.service.ts` | redirect-token Redis 存取 |
| `frontend/src/components/Layout.tsx` | 侧边栏跳转入口 |
