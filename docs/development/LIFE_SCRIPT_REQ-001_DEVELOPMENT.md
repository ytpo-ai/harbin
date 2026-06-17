# Development: LIFE_SCRIPT_REQ-001_DEVELOPMENT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 关联 Requirement | [REQ-001](../requirement/LIFE_SCRIPT_REQ-001_GATEWAY_ROUTING.md) |
| 所属 Feature | [LIFE_SCRIPT](../feature/LIFE_SCRIPT.md) |
| 所属 Plan | [LIFE_SCRIPT_ADMIN_INTEGRATION](../plan/LIFE_SCRIPT_ADMIN_INTEGRATION.md) |
| OpenCode Session | 当前会话 |
| 开发日期 | 2026-06-15 |
| 状态 | 已完成 |

## 2. 实现摘要

完成 Gateway 侧与 LifeScript 后端联通的接口能力，包括路由识别、path rewrite、白名单放行和 CORS 扩展，并补齐 Harbin 前端侧边栏入口与跳转逻辑。

## 3. 代码改动点

### 后端

| 文件 | 改动说明 |
|------|----------|
| `backend/apps/gateway/src/gateway-proxy.service.ts` | 新增 `/api/life-script/*` 目标路由，转发时剥离 `/api/life-script` 前缀 |
| `backend/apps/gateway/src/gateway-auth.guard.ts` | 增加 LifeScript 公开路径白名单规则（含方法约束） |
| `backend/apps/gateway/src/main.ts` | CORS 改为支持 `CORS_ORIGINS` 多 origin 配置 |
| `backend/.env.example` | 补充 `LIFE_SCRIPT_BASE_URL`、`CORS_ORIGINS` 配置示例 |
| `backend/apps/gateway/src/gateway-proxy.service.spec.ts` | 新增 life-script 目标路由与 rewrite 用例 |
| `backend/apps/gateway/src/gateway-auth.guard.spec.ts` | 新增 life-script 白名单和 token 校验用例 |

### 前端

| 文件 | 改动说明 |
|------|----------|
| `frontend/src/components/Layout.tsx` | 系统管理分组新增 LifeScript 入口，调用 redirect-token 接口并新窗口跳转管理台 |
| `frontend/src/services/authService.ts` | 新增 `generateLifeScriptRedirectToken()` 服务方法 |
| `frontend/.env.example` | 新增 `VITE_LIFE_SCRIPT_ADMIN_URL` 配置示例 |

### 数据库 / Schema

| 变更 | 说明 |
|------|------|
| 无 | 本需求不涉及数据库结构调整 |

## 4. 验证结果

- [x] 单元测试通过
- [x] Lint / TypeCheck 通过
- [x] 功能验证通过
- 验证说明：
  - `pnpm test -- gateway-proxy.service.spec.ts gateway-auth.guard.spec.ts auth.service.spec.ts`
  - `pnpm lint`
  - `pnpm exec tsc --noEmit`

## 5. 踩坑记录

- `PUBLIC_PATHS` 原先仅支持 path 级别，LifeScript 的 `/submissions` 需要按 `POST` 放行，因此补充了 method-aware 白名单规则。

## 6. 关联 Fix

| 日期 | 问题简述 | 文档 |
|------|----------|------|
