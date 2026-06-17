# Requirement: LIFE_SCRIPT_REQ-002_TOKEN_AUTH（Harbin 侧）

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-002 |
| 所属 Feature | [LIFE_SCRIPT](../feature/LIFE_SCRIPT.md) |
| 所属 Plan | [LifeScript 集成 — Harbin 侧改动](../plan/LIFE_SCRIPT_ADMIN_INTEGRATION.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | completed |
| 创建日期 | 2026-06-15 |
| 最后更新 | 2026-06-15 |

> **说明**：本文档仅覆盖 Harbin 侧的改动（redirect-token 签发 + Gateway LS token 验证）。LifeScript 侧的 token exchange 实现见 [`workspace/life_script/docs/requirement/`](../../workspace/life_script/docs/requirement/)。

## 2. 需求描述

### 2.1 背景

LifeScript 管理台作为独立前端运行，业务人员从 Harbin 跳转时不应二次登录。Harbin 需要提供：
1. 一次性 redirect-token 签发接口
2. Gateway 对 LifeScript session token 的验证能力

### 2.2 目标

1. Harbin Auth 模块新增 `POST /api/auth/issue-redirect-token` 接口
2. Gateway Auth Guard 支持验证 LifeScript session token（`LS_JWT_SECRET`）

### 2.3 验收条件

- [x] `POST /api/auth/issue-redirect-token` 接口签发一次性 token（30s 有效，存 Redis）
- [x] redirect-token Redis Key 格式：`redirect:life-script:{token}`，包含 `{ employeeId, email, name, role, issuedAt }`
- [x] 签发频率限制：10 次/分钟/用户
- [x] Gateway Auth Guard 对 `/api/life-script/*` 非白名单路径使用 `LS_JWT_SECRET` 验证 token
- [x] 验证通过后构建 `userContext` 并注入签名头，与 Harbin JWT 流程一致

## 3. 技术方案摘要

详见 [技术设计](../technical/LIFE_SCRIPT_GATEWAY_AUTH_EXTENSION_DESIGN.md) §3 Redirect Token 签发 和 §4 Gateway LS Token 验证。

### 影响范围

- **后端**：`auth.controller.ts` 新增接口、`auth.service.ts` 新增 Redis 存取 + rate-limit、`gateway-auth.guard.ts` 新增 LS token 验证分支
- **前端**：无（跳转逻辑在 REQ-001 的 Layout 改动中一并实现）
- **数据库**：Redis 新增 `redirect:life-script:*` 和 `redirect:rate:*` key
- **API**：新增 1 个接口
- **配置**：新增 `LS_JWT_SECRET` 环境变量

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/LIFE_SCRIPT_REQ-002_DEVELOPMENT.md) | 已完成 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- `LS_JWT_SECRET` 需与 LifeScript 后端使用相同值
- redirect-token 使用 `crypto.randomBytes(32)` 生成（256-bit 熵）
- 频率限制复用 Harbin 现有的 Feishu bind token rate-limit 模式
