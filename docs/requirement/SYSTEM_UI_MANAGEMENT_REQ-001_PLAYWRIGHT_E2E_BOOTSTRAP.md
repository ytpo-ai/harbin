# Requirement: SYSTEM_UI_MANAGEMENT_REQ-001_PLAYWRIGHT_E2E_BOOTSTRAP

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [SYSTEM_UI_MANAGEMENT](../feature/SYSTEM_UI_MANAGEMENT.md) |
| 所属 Plan | [SYSTEM_UI_MANAGEMENT_PLAYWRIGHT_E2E_BOOTSTRAP_PLAN](../plan/SYSTEM_UI_MANAGEMENT_PLAYWRIGHT_E2E_BOOTSTRAP_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-review |
| 创建日期 | 2026-04-23 |
| 最后更新 | 2026-04-23 |

## 2. 需求描述

### 2.1 背景

根目录虽已安装 Playwright，但当前仍保留官方模板配置与默认示例，不适配本项目前端运行方式，且无法直接验证项目页面行为。

### 2.2 目标

- 在本仓库完成 Playwright E2E 的可执行配置。
- 提供 2 个可复用的演示用例，作为后续 E2E 编写样板。
- 补充 1 个基于真实后端 token 的 smoke 用例，便于连通性快速验证。
- 提供统一脚本与 README 使用说明。

### 2.3 验收条件

- [ ] `playwright.config.ts` 已对接本项目前端服务（`webServer` + `baseURL`）。
- [ ] 根目录存在可直接执行的 E2E 脚本（至少包含 `test:e2e`）。
- [ ] 存在 2 个 demo 用例，且不依赖外部网站。
- [ ] README 补充 E2E 执行说明。
- [ ] 本地执行 E2E 用例通过。
- [ ] `E2E_AUTH_TOKEN` 可触发真实后端 smoke 用例。

## 3. 技术方案摘要

- 测试目录维持在根目录 `tests/`。
- 通过 Playwright `webServer` 自动启动 `frontend` 的 Vite 服务，避免手动起服务。
- Demo 用例采用 API mock（`page.route`）隔离后端依赖，保障稳定可运行。
- 真实后端 smoke 用例采用环境变量注入 token（`E2E_AUTH_TOKEN`），未提供时自动 skip。

### 影响范围

- **后端**：无
- **前端**：仅测试启动方式与页面行为验证，不改业务逻辑
- **数据库**：无
- **API**：无

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/SYSTEM_UI_MANAGEMENT_REQ-001_DEVELOPMENT.md) | 进行中 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| - | - | - |

## 5. 备注

- 首次执行需安装 Playwright 浏览器。
