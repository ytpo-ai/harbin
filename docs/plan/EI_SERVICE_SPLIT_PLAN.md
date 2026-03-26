# EI Service 拆分计划

> 目标：将 `backend/apps/ei/src/services/ei.service.ts`（1963 行、71 个方法）拆分为多个领域服务，消除 God Service。

## 1. 现状分析

### 1.1 核心问题

`ei.service.ts` 中的 `EngineeringIntelligence` 类承载了 7 个不同功能域，所有业务逻辑集中在单文件中。当前已有按域划分的 facade 服务（`repositories.service.ts`、`requirements.service.ts` 等），但它们全部是零逻辑的透传壳，直接委托给 `EngineeringIntelligence`。

### 1.2 现有 facade → 核心服务依赖关系

```
Controllers
  ├── EiRepositoriesController   → repositories.service.ts   ──┐
  ├── EiRequirementsController   → requirements.service.ts   ──┤
  ├── EiStatisticsController     → statistics.service.ts     ──┼──→ ei.service.ts (EngineeringIntelligence)
  └── EiOpencodeSyncController   → opencode-sync.service.ts  ──┘
```

### 1.3 注入依赖清单（当前 ei.service.ts 构造函数）

| 参数 | 类型 | 用途域 |
|------|------|--------|
| `repositoryModel` | `Model<EngineeringRepositoryDocument>` | 仓库、需求(GitHub target 解析) |
| `syncBatchModel` | `Model<EiOpenCodeRunSyncBatchDocument>` | OpenCode 同步 |
| `eventFactModel` | `Model<EiOpenCodeEventFactDocument>` | OpenCode 同步 |
| `runAnalyticsModel` | `Model<EiOpenCodeRunAnalyticsDocument>` | OpenCode 同步 |
| `statisticsSnapshotModel` | `Model<EiProjectStatisticsSnapshotDocument>` | 统计 |
| `requirementModel` | `Model<EiRequirementDocument>` | 需求 |
| `rdProjectModel` | `Model<RdProjectDocument>` | 统计 |
| `redisService` | `RedisService` | 统计(消息中心事件) |

---

## 2. 拆分策略

**核心思路**：将业务逻辑从 `ei.service.ts` 下沉到已有的同名 facade 服务中，使每个 facade 从"透传壳"变为真正持有业务逻辑的领域服务。最终删除 `ei.service.ts`。

**新增一个共享服务**：提取 GitHub API 基础设施为 `EiGithubClientService`，供 `repositories` 和 `requirements` 共同注入。

---

## 3. 拆分为 5 个领域服务

| # | 目标服务文件 | 功能域 | 方法数 | 预估行数 |
|---|---|---|---|---|
| 1 | `opencode-sync.service.ts` | OpenCode Run Sync & Event Ingestion + 输入校验 | ~12 | ~350 |
| 2 | `statistics.service.ts` | Workspace 扫描 + 项目统计快照 + 消息中心事件 | ~16 | ~430 |
| 3 | `requirements.service.ts` | 需求 CRUD + 状态机 + GitHub Issue 同步 | ~17 | ~350 |
| 4 | `repositories.service.ts` | 仓库 CRUD + 文档浏览 + 文档摘要 | ~19 | ~650 |
| 5 | `ei-github-client.service.ts`（新增） | GitHub API 基础设施（共享） | ~7 | ~120 |

---

## 4. 详细方法归属

### 4.1 `opencode-sync.service.ts` — OpenCode 数据同步与事件采集

**注入依赖**: `syncBatchModel`, `eventFactModel`, `runAnalyticsModel`

| 可见性 | 方法 | 原始行号 |
|--------|------|----------|
| private | `ensureContinuousSequence` | L188 |
| private | `upsertEventFacts` | L203 |
| private | `upsertRunAnalytics` | L243 |
| private | `ensureObject` | L286 |
| private | `ensureString` | L293 |
| private | `parseDate` | L301 |
| private | `parseOptionalDate` | L312 |
| private | `ensureNodeIdentity` | L319 |
| private | `verifyNodeSignatureSkeleton` | L327 |
| private | `normalizeOpenCodeRunSyncPayload` | L372 |
| **public** | **`syncOpenCodeRun`** | L412 |
| **public** | **`ingestOpenCodeEvents`** | L491 |

### 4.2 `statistics.service.ts` — 工程统计快照

**注入依赖**: `statisticsSnapshotModel`, `rdProjectModel`, `redisService`

| 可见性 | 方法 | 原始行号 |
|--------|------|----------|
| private | `resolveWorkspaceRoot` | L166 |
| private | `resolveWorkspacePath` | L830 |
| private | `shouldSkipDir` | L840 |
| private | `shouldIncludeFile` | L844 |
| private | `listWorkspaceSubdirectories` | L851 |
| private | `countLinesFromText` | L861 |
| private | `estimateTokensByChars` | L866 |
| private | `scanDirectoryMetrics` | L872 |
| private | `buildSummary` | L938 |
| private | `buildStatisticsRows` | L977 |
| private | `emitStatisticsMessage` | L1072 |
| private | `safeEmitStatisticsMessage` | L1126 |
| **public** | **`createStatisticsSnapshot`** | L1143 |
| **public** | **`getLatestStatisticsSnapshot`** | L1230 |
| **public** | **`getStatisticsSnapshotById`** | L1234 |
| **public** | **`listStatisticsSnapshots`** | L1242 |

### 4.3 `requirements.service.ts` — 需求管理

**注入依赖**: `requirementModel`, `repositoryModel`, `EiGithubClientService`

| 可见性 | 方法 | 原始行号 |
|--------|------|----------|
| private | `generateRequirementId` | L1247 |
| private | `generateEntityId` | L1251 |
| private | `normalizeStringList` | L1255 |
| private | `validateStatusTransition` | L1259 |
| private | `toBoardColumn` | L1269 |
| private | `resolveRequirementGithubTarget` | L1273 |
| private | `patchGithubIssueState` | L1517 |
| private | `syncGithubIssueLifecycle` | L1555 |
| **public** | **`createRequirement`** | L1311 |
| **public** | **`listRequirements`** | L1349 |
| **public** | **`getRequirementById`** | L1373 |
| **public** | **`deleteRequirement`** | L1382 |
| **public** | **`addRequirementComment`** | L1402 |
| **public** | **`assignRequirement`** | L1424 |
| **public** | **`updateRequirementStatus`** | L1466 |
| **public** | **`getRequirementBoard`** | L1582 |
| **public** | **`syncRequirementToGithub`** | L1605 |

> `STATUS_TRANSITIONS` 常量 (L140-147) 随需求域一同迁入。

### 4.4 `repositories.service.ts` — 仓库管理 & 文档浏览

**注入依赖**: `repositoryModel`, `EiGithubClientService`

| 可见性 | 方法 | 原始行号 |
|--------|------|----------|
| private | `isDocFilePath` | L614 |
| private | `listDirectoryRecursive` | L624 |
| private | `buildDocPathSuggestions` | L643 |
| private | `normalizeDocPath` | L663 |
| private | `getDocPathSuggestions` | L671 |
| private | `collectDocFiles` | L683 |
| private | `getContentItem` | L706 |
| private | `buildDocTree` | L716 |
| private | `summarizeSingleDoc` | L765 |
| private | `extractStackSignals` | L795 |
| private | `buildRepoSummary` | L809 |
| **public** | **`createRepository`** | L1684 |
| **public** | **`listRepositories`** | L1706 |
| **public** | **`updateRepository`** | L1713 |
| **public** | **`deleteRepository`** | L1729 |
| **public** | **`summarizeRepository`** | L1736 |
| **public** | **`getRepositoryDocsTree`** | L1804 |
| **public** | **`getRepositoryDocContent`** | L1836 |
| **public** | **`getRepositoryDocHistory`** | L1908 |

### 4.5 `ei-github-client.service.ts`（新增） — GitHub API 共享基础设施

**注入依赖**: 无（纯工具类，读取环境变量）

| 可见性 | 方法 | 原始行号 |
|--------|------|----------|
| public | `parseGithubUrl` | L531 |
| public | `getGitHubToken` | L541 |
| public | `githubRequest<T>` | L549 |
| public | `isGitHub404` | L566 |
| public | `getDefaultBranch` | L571 |
| public | `runWithBranchFallback<T>` | L576 |
| public | `githubTextRequest` | L600 |

---

## 5. 执行步骤

| 步骤 | 内容 | 风险 | 说明 |
|------|------|------|------|
| 1 | 新建 `ei-github-client.service.ts`，提取 GitHub API 基础设施方法 | 低 | 纯基础设施，无业务状态 |
| 2 | 迁移仓库逻辑到 `repositories.service.ts` | 中 | 方法最多（19个），需仔细处理 import 和文档分析逻辑 |
| 3 | 迁移需求逻辑到 `requirements.service.ts` | 中 | 状态机 + GitHub Issue 同步逻辑较复杂 |
| 4 | 迁移统计逻辑到 `statistics.service.ts` | 中 | 文件系统扫描 + Redis 事件发布 |
| 5 | 迁移 OpenCode 同步逻辑到 `opencode-sync.service.ts` | 低 | 边界清晰，独立性强 |
| 6 | 从 `ei.service.ts` 移除已迁移代码，确认可完全删除 | 低 | 逐步验证 |
| 7 | 更新 `app.module.ts` 的 providers 注册（移除 `EngineeringIntelligence`，新增 `EiGithubClientService`） | 低 | — |
| 8 | 运行 lint + typecheck + 接口测试验证 | — | 确保无回归 |

---

## 6. 关键风险与应对

| 风险 | 应对策略 |
|------|----------|
| GitHub API 方法被 repositories 和 requirements 两个域共用 | 提取为独立的 `EiGithubClientService`，两个域服务均注入使用 |
| `STATUS_TRANSITIONS` 常量跨文件引用 | 随需求域迁入 `requirements.service.ts`，如有其他文件引用则提取到 `constants/` |
| 需求域需访问 `repositoryModel` 解析 GitHub target | 保留跨域 model 注入，属于合理的查询依赖 |
| Controller 层是否需要改动 | **无需改动** — Controller 注入的是 facade 服务名，方法签名保持不变 |
| `app.module.ts` providers 注册 | 移除 `EngineeringIntelligence`，新增 `EiGithubClientService`，其余 facade 服务名不变 |

---

## 7. 预期效果

| 指标 | 拆分前 | 拆分后 |
|------|--------|--------|
| `ei.service.ts` 行数 | 1963 | **删除** |
| 最大单文件行数 | 1963 | ~650（`repositories.service.ts`） |
| 领域服务数量 | 1（God Service） | 5（各司其职） |
| facade 透传层 | 存在（无逻辑） | **消除**（逻辑已下沉） |
| Controller 改动 | — | 零改动 |
