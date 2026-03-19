# Prompt Registry API

## 基础信息

- Agents 服务直连：`http://localhost:3002/api`
- 经 Gateway 访问：`http://localhost:3100/api`
- 负责域：系统 Prompt 模板管理（会议场景、计划编排场景）

## 模板管理（`/prompt-registry`）

- `GET /prompt-registry/templates`
  - 查询模板列表
  - query: `scene?` `role?` `status?=draft|published|archived|all` `limit?`

- `GET /prompt-registry/templates/filters`
  - 查询筛选元数据（基于数据库现有数据）
  - response: `scenes[]` `roles[]` `statuses[]` `sceneRoleMap`

- `GET /prompt-registry/templates/effective`
  - 查询当前生效 Prompt（按 Resolver 优先级解析）
  - query: `scene` `role` `sessionOverride?`

- `GET /prompt-registry/templates/:id`
  - 查询模板详情（用于详情页编辑与日志联动）

- `POST /prompt-registry/templates/draft`
  - 保存新草稿版本（自动 `version+1`）
  - body: `scene` `role` `content` `description?` `baseVersion?` `summary?`
  - 支持“复制后全字段修改”场景：可直接提交新的 `scene/role/description/content`

- `DELETE /prompt-registry/templates/:id`
  - 删除指定模板版本
  - 约束：`published` 版本不可删除，仅允许删除 `draft/archived`

- `POST /prompt-registry/templates/publish`
  - 发布指定版本，已有 `published` 自动归档
  - body: `scene` `role` `version` `summary?`

- `POST /prompt-registry/templates/unpublish`
  - 取消发布指定版本（`published -> archived`）
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
- `unpublish`
- `rollback`

## 缓存策略说明

- 已发布 Prompt 的 Redis 缓存键：`prompt-registry:scene:{scene}:role:{role}:published`
- 缓存不过期（无 TTL），由发布链路主动刷新
- 触发刷新时机：`publish` 与 `rollback`（先删除旧键，再写入最新发布版本）
