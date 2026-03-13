# EI Project Triple Source Binding Plan

## 1. 背景与目标

- EI 项目需要统一支持三种来源：`local`、`opencode`、`github`。
- 支持后续多项目管理：每个本地项目可绑定多个 OpenCode 项目。
- GitHub 绑定改为单仓库约束：每个本地项目最多绑定 1 个 GitHub 仓库。
- GitHub token 不落库明文，复用现有 API Key 能力（通过 `apiKeyId` 引用）。

## 2. 执行步骤

1. 扩展 `ei_projects` 数据模型：新增来源类型字段与三类来源专属字段。
2. 新增绑定字段与索引：支持 `local -> N opencode + 1 github`。
3. 改造 OpenCode 同步链路：同步创建/更新项目时标记 `sourceType=opencode`，保留现有幂等行为。
4. 新增本地项目创建与绑定接口：创建 local 项目、绑定 opencode 项目、绑定/更新 github 仓库。
5. GitHub 绑定接入 API Key 校验：`githubApiKeyId` 必填并校验可用性，不返回明文 token。
6. 前端服务层补充新接口类型定义，保留现有页面兼容。
7. 更新 feature/api/dailylog 文档并完成最小验证（lint/typecheck）。

## 3. 关键影响点

- 后端：`rd-management` schema、service、controller、dto 与模块依赖。
- 数据库：`ei_projects` 新字段与唯一约束（github 单绑定、opencode 去重）。
- 前端：`rdConversationService` 新增绑定接口与类型。
- 安全：GitHub token 通过 API Key 引用，避免明文存储和回传。

## 4. 风险与依赖

- 历史项目数据未设置 `sourceType`，需兼容旧记录读写。
- 绑定关系新增后，老查询结果可能混入 `github` 类型项目，需要可选筛选字段。
- API Key provider 命名可能不统一（`github`/`git`），需做兼容校验策略。

## 5. 完成标准

- `ei_projects` 可表达 local/opencode/github 三种来源。
- OpenCode 同步项目可持续幂等写入，并可绑定到本地项目。
- 本地项目可绑定多个 OpenCode 项目且最多 1 个 GitHub 仓库。
- GitHub 绑定通过 `githubApiKeyId` 引用现有 API Key，不暴露 token 明文。
- 对应功能/API/日志文档完成更新。
