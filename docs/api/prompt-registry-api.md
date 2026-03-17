# Prompt Registry API

## 基础信息

- Agents 服务直连：`http://localhost:3002/api`
- 经 Gateway 访问：`http://localhost:3100/api`
- 负责域：系统 Prompt 模板管理（会议场景、计划编排场景）

## 模板管理（`/prompt-registry`）

- `GET /prompt-registry/templates`
  - 查询模板列表
  - query: `scene?` `role?` `status?=draft|published|archived|all` `limit?`

- `GET /prompt-registry/templates/effective`
  - 查询当前生效 Prompt（按 Resolver 优先级解析）
  - query: `scene` `role` `sessionOverride?`

- `POST /prompt-registry/templates/draft`
  - 保存新草稿版本（自动 `version+1`）
  - body: `scene` `role` `content` `baseVersion?` `summary?`

- `POST /prompt-registry/templates/publish`
  - 发布指定版本，已有 `published` 自动归档
  - body: `scene` `role` `version` `summary?`

- `POST /prompt-registry/templates/rollback`
  - 回滚到历史版本并创建新的 `published` 版本
  - body: `scene` `role` `targetVersion` `summary?`

- `GET /prompt-registry/templates/diff`
  - 版本对比（行级新增/删除统计 + 预览）
  - query: `scene` `role` `baseVersion` `targetVersion`

- `GET /prompt-registry/audits`
  - 查询审计日志（操作者、时间、动作、版本、摘要）
  - query: `scene?` `role?` `limit?`

## 审计动作枚举

- `create_draft`
- `publish`
- `rollback`
