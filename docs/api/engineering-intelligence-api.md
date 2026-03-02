# Engineering Intelligence API

## 基础信息

- 服务地址（直连）：`http://localhost:3201/api`
- 经 Gateway 访问：`http://localhost:3100/api/engineering-intelligence`
- 服务职责：仓库配置管理、docs 目录浏览、文档摘要与历史追踪

## Repositories（`/engineering-intelligence/repositories`）

- `GET /repositories`：获取仓库配置列表
- `POST /repositories`：新增仓库配置（支持 branch）
- `PUT /repositories/:id`：更新仓库配置
- `DELETE /repositories/:id`：删除仓库配置

## 文档处理

- `POST /repositories/:id/summarize`：触发文档摘要
- `GET /repositories/:id/docs/tree`：获取 docs 目录树
- `GET /repositories/:id/docs/content?path=docs/...`：获取文档正文
- `GET /repositories/:id/docs/history?path=docs/...&limit=20`：获取文档更新记录与贡献统计

## 说明

- 历史兼容路径 `/api/cto-docs/*` 已移除。
- 前端入口位于主前端应用：`/engineering-intelligence`。
