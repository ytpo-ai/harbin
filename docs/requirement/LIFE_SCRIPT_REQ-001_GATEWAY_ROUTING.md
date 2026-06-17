# Requirement: LIFE_SCRIPT_REQ-001_GATEWAY_ROUTING

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [LIFE_SCRIPT](../feature/LIFE_SCRIPT.md) |
| 所属 Plan | [LifeScript 集成 — Harbin 侧改动](../plan/LIFE_SCRIPT_ADMIN_INTEGRATION.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | completed |
| 创建日期 | 2026-06-15 |
| 最后更新 | 2026-06-15 |

## 2. 需求描述

### 2.1 背景

LifeScript 管理台 API 需要经过 Harbin Gateway 进行统一认证和代理转发。Gateway 需要将 LifeScript 相关上游统一指向 `LIFE_SCRIPT_BASE_URL`（默认 `http://localhost:3101`），避免混用 `3001/3101`。

### 2.2 目标

1. Gateway `resolveTarget()` 新增 `/api/life-script` 路由规则
2. 转发时 strip `/life-script` 前缀（path rewrite）
3. Gateway 白名单新增 LifeScript 公开路径
4. CORS 配置支持管理台前端 origin
5. Harbin 前端 Layout 侧边栏新增 LifeScript 跳转入口

### 2.3 验收条件

- [x] Gateway `resolveTarget()` 正确将 `/api/life-script/*` 路由到 `LIFE_SCRIPT_BASE_URL`（默认 `http://localhost:3101`）
- [x] 转发时正确 strip 前缀：`/api/life-script/admin/submissions` → `/api/admin/submissions`
- [x] Gateway 白名单新增：`/api/life-script/auth/exchange`、`/api/life-script/submissions`（POST）、`/api/life-script/upload`
- [x] CORS 配置支持 `http://localhost:3200`（LifeScript 管理台 origin，通过环境变量可配）
- [x] 新增环境变量：`LIFE_SCRIPT_BASE_URL`
- [x] `POST /api/auth/issue-redirect-token` 上游路由与 `/api/life-script/*` 保持一致，统一走 `LIFE_SCRIPT_BASE_URL`
- [x] Harbin Layout 侧边栏"系统管理"分组新增 "LifeScript" 外链入口
- [x] 点击入口调用 `POST /api/auth/issue-redirect-token`，获取 token 后新窗口打开管理台

## 3. 技术方案摘要

详见 [技术设计](../technical/LIFE_SCRIPT_GATEWAY_AUTH_EXTENSION_DESIGN.md) §2 Gateway 路由扩展。

### 转发映射示例

| 前端请求 | Gateway 转发目标 |
|---------|-----------------|
| `GET /api/life-script/admin/submissions` | `GET http://localhost:3101/api/admin/submissions` |
| `POST /api/life-script/auth/exchange` | `POST http://localhost:3101/api/auth/exchange` |
| `POST /api/life-script/submissions` | `POST http://localhost:3101/api/submissions` |

### 影响范围

- **后端**：`gateway-proxy.service.ts` 路由规则 + path rewrite、`gateway-auth.guard.ts` 白名单、`gateway/main.ts` CORS
- **前端**：`Layout.tsx` 侧边栏入口 + 跳转逻辑
- **配置**：`LIFE_SCRIPT_BASE_URL`、`VITE_LIFE_SCRIPT_ADMIN_URL`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/LIFE_SCRIPT_REQ-001_DEVELOPMENT.md) | 已完成 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 路由规则需放在 legacy fallback 之前、agents 路由之后
- path rewrite 仅针对 `/api/life-script` 前缀，其他路由不受影响
