# UI 管理

## 1. 功能设计
- 目标：在系统管理域提供统一的 UI 资源查看入口，便于设计与研发快速检索图标资产。
- 数据结构：前端运行时图标清单（name、set、component），由 Heroicons 导出动态枚举，不依赖后端存储。
- 核心逻辑：`系统管理 > UI管理` 菜单进入页面；页面使用 Tab 容器承载子能力；`图标管理` Tab 支持按关键字与样式（outline/solid）筛选并网格展示。

## 2. 需求追溯

| Plan | Requirement | Development | Fix |
|------|------------|-------------|-----|
| [SYSTEM_UI_MANAGEMENT_PLAYWRIGHT_E2E_BOOTSTRAP_PLAN](../plan/SYSTEM_UI_MANAGEMENT_PLAYWRIGHT_E2E_BOOTSTRAP_PLAN.md) | [SYSTEM_UI_MANAGEMENT_REQ-001_PLAYWRIGHT_E2E_BOOTSTRAP](../requirement/SYSTEM_UI_MANAGEMENT_REQ-001_PLAYWRIGHT_E2E_BOOTSTRAP.md) | [开发记录](../development/SYSTEM_UI_MANAGEMENT_REQ-001_DEVELOPMENT.md) | — |

## 3. 相关文档
- 规划文档：
  - `docs/plan/SYSTEM_UI_MANAGEMENT_ICON_TAB_PLAN.md`
  - `docs/plan/SYSTEM_UI_MANAGEMENT_PLAYWRIGHT_E2E_BOOTSTRAP_PLAN.md`
- 需求文档：
  - `docs/requirement/SYSTEM_UI_MANAGEMENT_REQ-001_PLAYWRIGHT_E2E_BOOTSTRAP.md`
- 开发总结：暂无（待补充）
- 技术文档：暂无
- API 文档：无（纯前端能力）

## 4. 相关代码文件
- 后端代码：无
- 前端代码：
  - `frontend/src/components/Layout.tsx`
  - `frontend/src/App.tsx`
  - `frontend/src/pages/UiManagement.tsx`
- 测试与配置：
  - `playwright.config.ts`
  - `tests/login-page.demo.spec.ts`
  - `tests/login-success.demo.spec.ts`
