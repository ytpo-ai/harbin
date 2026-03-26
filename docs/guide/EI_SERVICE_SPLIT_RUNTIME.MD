# EI Service Split Runtime（缓存）

## 1. 目标与结果

- 原 `backend/apps/ei/src/services/ei.service.ts`（God Service）已拆分并删除。
- 现按领域聚合为 4 个业务服务 + 1 个 GitHub 基础设施服务。
- Controller 层保持原注入服务名与接口签名，无需改动路由层。

## 2. 领域服务职责映射

| 服务文件 | 核心职责 | 主要依赖 |
|---|---|---|
| `services/repositories.service.ts` | 仓库配置 CRUD、文档树/内容/历史查询、仓库文档摘要 | `EngineeringRepositoryModel`、`EiGithubClientService` |
| `services/requirements.service.ts` | 需求 CRUD、状态机、评论/分配、GitHub Issue 同步与生命周期联动 | `EiRequirementModel`、`RdProjectModel`、`EiGithubClientService` |
| `services/statistics.service.ts` | Workspace 扫描、统计快照落库、消息中心事件发布 | `EiProjectStatisticsSnapshotModel`、`RedisService` |
| `services/opencode-sync.service.ts` | OpenCode run/batch 入库、事件/分析表 upsert、签名校验与批处理 ingest | `EiOpenCodeRunSyncBatchModel`、`EiOpenCodeEventFactModel`、`EiOpenCodeRunAnalyticsModel` |
| `services/ei-github-client.service.ts` | GitHub URL 解析、Token 读取、API 请求封装、404/分支 fallback | 环境变量 `GITHUB_TOKEN` |

## 3. 模块装配变化

- `app.module.ts` providers 移除 `EngineeringIntelligence`。
- `app.module.ts` providers 新增 `EiGithubClientService`。
- 现有 facade 服务（`EiRepositoriesService`、`EiRequirementsService`、`EiStatisticsService`、`EiOpencodeSyncService`）已从透传改为直接承载业务逻辑。

## 4. 关键约束

- 禁止恢复 `ei.service.ts` 聚合模式，新增能力应进入对应领域服务。
- 共享 GitHub 调用必须复用 `EiGithubClientService`，避免跨服务重复实现请求/鉴权/fallback。
- 需求域 GitHub 目标解析仍基于 `RdProject.githubBindingId`，保持与现有项目绑定模型一致。
