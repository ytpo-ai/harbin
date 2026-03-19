# UI 管理

## 1. 功能设计
- 目标：在系统管理域提供统一的 UI 资源查看入口，便于设计与研发快速检索图标资产。
- 数据结构：前端运行时图标清单（name、set、component），由 Heroicons 导出动态枚举，不依赖后端存储。
- 核心逻辑：`系统管理 > UI管理` 菜单进入页面；页面使用 Tab 容器承载子能力；`图标管理` Tab 支持按关键字与样式（outline/solid）筛选并网格展示。

## 2. 相关文档
- 规划文档：`docs/plan/SYSTEM_UI_MANAGEMENT_ICON_TAB_PLAN.md`
- 开发总结：暂无（待补充）
- 技术文档：暂无
- API 文档：无（纯前端能力）

## 3. 相关代码文件
- 后端代码：无
- 前端代码：
  - `frontend/src/components/Layout.tsx`
  - `frontend/src/App.tsx`
  - `frontend/src/pages/UiManagement.tsx`
