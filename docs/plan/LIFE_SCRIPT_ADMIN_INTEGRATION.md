# Plan: LifeScript 集成 — Harbin 侧改动

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [LIFE_SCRIPT](../feature/LIFE_SCRIPT.md) |
| 需求管理 ID | — |
| 所属项目 | LifeScript (孵化项目，`workspace/life_script/`) |
| OpenCode Session | — |
| 状态 | completed |
| 优先级 | high |
| 创建日期 | 2026-06-15 |

> **说明**：本文档仅覆盖 Harbin 侧的改动。LifeScript 侧的 plan 见 [`workspace/life_script/docs/plan/LIFE_SCRIPT_ADMIN_INTEGRATION.md`](../../workspace/life_script/docs/plan/LIFE_SCRIPT_ADMIN_INTEGRATION.md)。

## 2. 背景

LifeScript 是 Harbin 平台孵化的八字分析预测项目（`workspace/life_script/`），需要接入 Harbin 的以下能力：
1. **Gateway 代理**：管理台 API 统一经 Harbin Gateway 认证和转发
2. **Token 跳转**：Harbin 用户免二次登录跳转到 LifeScript 独立管理台
3. **Agents 能力**（后续）：利用 agents 服务自动化八字分析流程

选择**方案 B：独立管理台 + Gateway 代理 + Token 跳转**，LifeScript 管理台为独立 SPA，不嵌入 Harbin 前端。

## 3. 目标

1. Gateway 支持 `/api/life-script/*` 路由，代理到 LifeScript 后端
2. Auth 模块新增 redirect-token 签发接口，供跳转认证使用
3. Gateway Auth Guard 支持验证 LifeScript session token
4. Harbin 前端侧边栏新增 LifeScript 跳转入口

## 4. 执行步骤

1. [x] 设计整体集成架构
2. [x] Gateway `resolveTarget()` 新增 `/api/life-script` 路由规则 + path rewrite
3. [x] Gateway Auth Guard 新增白名单路径 + LifeScript token 验证
4. [x] Gateway CORS 配置新增 LifeScript 管理台 origin
5. [x] Auth Controller/Service 新增 `POST /api/auth/issue-redirect-token` 接口
6. [x] Harbin 前端 Layout 侧边栏新增 LifeScript 跳转入口

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | Gateway 路由扩展（路由规则 + path rewrite + CORS + 白名单） | [链接](../requirement/LIFE_SCRIPT_REQ-001_GATEWAY_ROUTING.md) | completed |
| REQ-002 | Redirect-token 签发 + Gateway LS token 验证 | [链接](../requirement/LIFE_SCRIPT_REQ-002_TOKEN_AUTH.md) | completed |

> REQ-003（管理台前端工程）属于 LifeScript 侧，见 [`workspace/life_script/docs/requirement/`](../../workspace/life_script/docs/requirement/)。

## 6. 关键影响点

- **后端**：`gateway-proxy.service.ts` 路由规则、`gateway-auth.guard.ts` 白名单+LS token 验证、`auth.controller.ts` 新增接口、`gateway/main.ts` CORS
- **前端**：`Layout.tsx` 侧边栏入口 + 跳转逻辑
- **数据库**：无变更
- **API**：新增 `POST /api/auth/issue-redirect-token`
- **配置**：新增环境变量 `LIFE_SCRIPT_BASE_URL`、`LS_JWT_SECRET`、`VITE_LIFE_SCRIPT_ADMIN_URL`

## 7. 风险与依赖

| 风险/依赖 | 说明 | 缓解措施 |
|-----------|------|----------|
| 密钥共享 | Gateway 需要 `LS_JWT_SECRET` 验证 LifeScript token | 环境变量统一管理 |
| CORS | 管理台前端与 Gateway 不同 origin | 显式配置允许的 origin |
| 依赖 LifeScript 侧就绪 | Gateway 路由指向 :3101，需 LifeScript 后端先完成端口调整 | 联调阶段统一验证 |

## 8. 备注

### 技术设计

- Harbin 侧：[LIFE_SCRIPT_GATEWAY_AUTH_EXTENSION_DESIGN](../technical/LIFE_SCRIPT_GATEWAY_AUTH_EXTENSION_DESIGN.md)
- LifeScript 侧：[`workspace/life_script/docs/technical/LIFE_SCRIPT_ADMIN_INTEGRATION_DESIGN.md`](../../workspace/life_script/docs/technical/LIFE_SCRIPT_ADMIN_INTEGRATION_DESIGN.md)

### 架构全景

```
┌────────────────────┐      ┌─────────────────────────┐
│  Harbin Frontend   │      │  LifeScript Admin SPA   │
│  (port 3000)       │      │  (port 3200)            │
│                    │      │                         │
│  侧边栏 "LifeScript"│─────→│  接收 token, 独立运行     │
│  点击跳转带 token   │      │  未来可加独立登录         │
└────────┬───────────┘      └────────┬────────────────┘
         │ /api/*                    │ /api/life-script/*
         ▼                           ▼
┌──────────────────────────────────────────────────────┐
│                Gateway (port 3100)                    │
│                                                       │
│  /api/life-script/*  → LifeScript Backend (:3101)     │
│  /api/agents/*       → Agents Service (:3002)         │
│  /api/ei/*           → EI Service (:3004)             │
│  /api/*              → Legacy Service (:3001)         │
└──────────────────────────────────────────────────────┘
```
