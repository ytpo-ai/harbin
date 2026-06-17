# Development: LIFE_SCRIPT_REQ-002_DEVELOPMENT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 关联 Requirement | [REQ-002](../requirement/LIFE_SCRIPT_REQ-002_TOKEN_AUTH.md) |
| 所属 Feature | [LIFE_SCRIPT](../feature/LIFE_SCRIPT.md) |
| 所属 Plan | [LIFE_SCRIPT_ADMIN_INTEGRATION](../plan/LIFE_SCRIPT_ADMIN_INTEGRATION.md) |
| OpenCode Session | 当前会话 |
| 开发日期 | 2026-06-15 |
| 状态 | 已完成 |

## 2. 实现摘要

完成 Harbin 侧 redirect-token 签发接口与 Gateway 对 LifeScript session token 的独立鉴权链路，满足独立管理台免登录跳转的服务端接口能力。

## 3. 代码改动点

### 后端

| 文件 | 改动说明 |
|------|----------|
| `backend/src/modules/auth/auth.controller.ts` | 新增 `POST /api/auth/issue-redirect-token` 接口 |
| `backend/src/modules/auth/auth.service.ts` | 新增 redirect-token 签发逻辑（30s TTL、`redirect:rate:*` 限流、`redirect:life-script:*` 存储） |
| `backend/apps/gateway/src/gateway-auth.guard.ts` | 对 `/api/life-script/*` 非白名单请求使用 `LS_JWT_SECRET` 校验并注入 `userContext` |
| `backend/.env.example` | 补充 `LS_JWT_SECRET` 和 redirect-token 相关可配置项 |
| `backend/src/modules/auth/auth.service.spec.ts` | 新增 redirect-token 签发成功/限流/员工不存在用例 |

### 前端

| 文件 | 改动说明 |
|------|----------|
| — | 本需求不涉及前端改动 |

### 数据库 / Schema

| 变更 | 说明 |
|------|------|
| Redis Key | 新增 `redirect:life-script:{token}` 与 `redirect:rate:{employeeId}` |

## 4. 验证结果

- [x] 单元测试通过
- [x] Lint / TypeCheck 通过
- [x] 功能验证通过
- 验证说明：
  - `pnpm test -- gateway-proxy.service.spec.ts gateway-auth.guard.spec.ts auth.service.spec.ts`
  - `pnpm lint`
  - `pnpm exec tsc --noEmit`

## 5. 踩坑记录

- 为兼容现有 Gateway 鉴权结构，LifeScript token 校验复用了 `verifyEmployeeToken`，通过 `LS_JWT_SECRET` 实现与 Harbin JWT 解耦。

## 6. 关联 Fix

| 日期 | 问题简述 | 文档 |
|------|----------|------|
