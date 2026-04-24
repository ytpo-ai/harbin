# Playwright E2E 基础配置与 Demo 用例计划

## 1. 需求背景

项目已安装 `@playwright/test` 并存在默认模板文件，但当前配置仍是 Playwright 官方示例，尚未对接本仓库前端启动方式，也缺少可直接复用的业务 Demo 用例。

## 2. 目标

- 完成 Playwright 在当前仓库的可运行配置（自动拉起前端、统一 baseURL、统一执行脚本）。
- 提供 2 个可直接执行的 Demo 用例，覆盖基础页面交互与登录流程。
- 补充最小运行文档，降低后续接入真实 E2E 用例的门槛。

## 3. 实施步骤

1. 更新 `playwright.config.ts`：配置 `baseURL`、`webServer`、reporter 与浏览器项目。
2. 更新根目录 `package.json`：补充 `test:e2e` 系列脚本。
3. 替换默认示例用例：新增两个本项目可运行的 demo spec，并移除外部站点示例。
4. 更新 README：增加 Playwright E2E 执行说明。
5. 本地执行 `npx playwright test` 验证配置可用。

## 4. 影响范围

- **前端**：`frontend` 开发服务器会被 Playwright 自动拉起用于测试。
- **测试**：新增 E2E demo 用例与执行脚本。
- **文档**：更新 README 与 feature/requirement 追溯信息。
- **后端 / 数据库 / API**：无结构性变更。

## 5. Requirement 拆解

| Requirement | 说明 | 状态 |
|-------------|------|------|
| [SYSTEM_UI_MANAGEMENT_REQ-001_PLAYWRIGHT_E2E_BOOTSTRAP](../requirement/SYSTEM_UI_MANAGEMENT_REQ-001_PLAYWRIGHT_E2E_BOOTSTRAP.md) | Playwright 配置落地 + 2 个 demo 用例 + 文档说明 | in-review |
