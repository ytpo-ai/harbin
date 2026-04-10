# Skill 市场三层架构实现计划

## 背景

现有系统中 `agent_skills` 集合将来自 GitHub 的仓库数据与本地 Skill 数据混合存储，缺少聚合检索平台与 GitHub 仓库的独立层级管理能力。

本计划引入三层结构，明确各层职责边界：

| 层级 | 集合 | 说明 |
|---|---|---|
| Layer 1 | `skill_market_platforms` | Skills 聚合检索平台（如 agentskills.best） |
| Layer 2 | `skill_github_repos` | 从平台索引得到的 GitHub 仓库列表 |
| Layer 3 | `agent_skills` | 真正被 Agent 绑定和消费的 Skill 数据（现有集合） |

---

## 数据模型设计

### Layer 1 — `skill_market_platforms`（新集合）

```typescript
{
  id: string                    // UUID
  name: string                  // 展示名，如 "AgentSkills Best"
  url: string                   // 平台根 URL，唯一约束
  priority: number              // 数值越小优先级越高，默认 100
  status: 'active' | 'disabled'
  description?: string
  lastIndexedAt?: Date          // 最近一次索引完成时间
  repoCount?: number            // 已索引仓库数量（冗余字段）
  createdAt / updatedAt
}
```

### Layer 2 — `skill_github_repos`（新集合）

```typescript
{
  id: string                    // UUID
  platformId: string            // → skill_market_platforms.id
  fullName: string              // "owner/repo"，唯一约束
  url: string                   // GitHub 仓库 HTML URL
  description?: string
  stars: number
  language?: string
  topics: string[]              // GitHub topics
  owner: string                 // repo owner login
  indexedAt: Date               // 本次索引时间
  status: 'pending' | 'imported' | 'skipped'
  // pending  = 已从平台发现，尚未导入为 Skill
  // imported = 已导入为 agent_skills 记录
  // skipped  = 用户手动忽略
  skillId?: string              // 导入后 → agent_skills.id
  createdAt / updatedAt
}
```

索引：
- `{ platformId: 1, status: 1 }`
- `{ fullName: 1 }` unique
- `{ stars: -1 }`

### Layer 3 — `agent_skills`（现有集合，最小扩展）

新增一个字段：
```typescript
repoId?: string   // → skill_github_repos.id（若从市场导入，否则为空）
```

---

## 数据流

```
用户添加平台 URL
      ↓
skill_market_platforms 写入（Layer 1）
      ↓
触发"索引平台"（手动）
      ↓
SkillMarketService 爬取平台页面
  → 提取 github.com/{owner}/{repo} 链接
  → 调用 GitHub API 获取仓库详情
  → upsert 写入 skill_github_repos（Layer 2，status=pending）
  → 更新 platform.lastIndexedAt / repoCount
      ↓
用户在仓库列表选择"导入"
      ↓
skill_github_repos.status → imported
agent_skills 写入（Layer 3，repoId 指向 Layer 2）
      ↓
可继续编辑 content、绑定 Agent
```

---

## 后端实现步骤

### Step 1 — 新增 Schema

**文件**：
- `backend/apps/agents/src/schemas/skill-market-platform.schema.ts`
- `backend/apps/agents/src/schemas/skill-github-repo.schema.ts`
- `backend/apps/agents/src/schemas/agent-skill.schema.ts`（新增 `repoId` 字段）

### Step 2 — 新增 SkillMarketService

**文件**：`backend/apps/agents/src/modules/skills/skill-market.service.ts`

核心方法：
- `createPlatform(payload)` — 添加平台
- `updatePlatform(id, updates)` — 更新平台（名称/优先级/状态）
- `deletePlatform(id)` — 删除平台（同步删除关联 repos）
- `listPlatforms()` — 列出所有平台（按 priority 排序）
- `indexPlatform(platformId)` — 爬取平台页面 → 提取 GitHub 仓库链接 → 调用 GitHub API → upsert Layer 2
- `listRepos(filters)` — 列出已索引仓库（支持 platformId/status/search/分页）
- `skipRepo(repoId)` — 标记为 skipped
- `importRepo(repoId)` — 从 Layer 2 导入为 Layer 3 Skill
- `searchMarket(keyword, platformId?)` — 先查本地 Layer 2，不足时按优先级查 GitHub API

### Step 3 — 新增 SkillMarketController

**文件**：`backend/apps/agents/src/modules/skills/skill-market.controller.ts`

接口清单：

```
# 平台管理（Layer 1）
GET    /skills/market/platforms              列出所有平台
POST   /skills/market/platforms             添加平台
PUT    /skills/market/platforms/:id         更新平台
DELETE /skills/market/platforms/:id         删除平台
POST   /skills/market/platforms/:id/index   触发平台索引

# 仓库管理（Layer 2）
GET    /skills/market/repos                 列出仓库（支持 platformId/status/search/分页）
PUT    /skills/market/repos/:id/skip        标记忽略
POST   /skills/market/repos/:id/import      导入为 Skill（Layer 2 → Layer 3）

# 市场检索
POST   /skills/market/search               关键词检索

# 平台索引任务进度（SSE）
GET    /skills/market/index-tasks/:taskId/events   订阅索引进度流
```

索引执行建议升级为“任务化 + 实时事件流”模式：

- `POST /skills/market/platforms/:id/index`：仅负责创建索引任务并立即返回 `taskId`
- 后端异步执行实际索引逻辑，持续更新任务进度状态
- 前端基于 SSE 订阅任务进度并实时展示（进行中 / 当前仓库 / 失败计数 / 完成态）

### Step 4 — 更新 SkillModule

在 `skill.module.ts` 中注册两个新 Schema 和 `SkillMarketService`、`SkillMarketController`。

---

## 前端实现步骤

### Step 5 — 新增类型定义

在 `frontend/src/types/index.ts` 新增：
- `SkillMarketPlatform`
- `SkillGithubRepo`

### Step 6 — 新增 skillMarketService

**文件**：`frontend/src/services/skillMarketService.ts`

封装所有 `/skills/market/*` API 调用。

### Step 7 — Skills.tsx 新增"Skill 市场"Tab

在现有 Tab 区域新增"Skill 市场"Tab，内含三个子区域：

**子区域 A — 平台管理**
- 卡片列表：名称 / URL / 优先级 / 状态 / 仓库数 / 最近索引时间
- 操作：添加平台（弹窗）、启用/禁用切换、删除、手动触发索引

**子区域 B — 仓库索引列表**
- 筛选：平台 / status（pending/imported/skipped）/ 关键词
- 仓库卡片：fullName / description / stars / language / topics / status
- 操作：导入（→ Layer 3）、忽略

**子区域 C — 市场检索**
- 关键词 + 平台选择（或全部）
- 展示结果：仓库卡片 + status 标记
- 支持一键导入到 Layer 3

### Step 8 — 平台索引改为 SSE 实时反馈

后端：
- 新增索引任务模型（`taskId`、`status`、`total`、`scanned`、`indexed`、`failed`、`currentRepo`、`message`、`startedAt`、`finishedAt`）
- `POST /skills/market/platforms/:id/index` 改为“启动任务并返回 taskId”
- 新增 SSE 接口：`GET /skills/market/index-tasks/:taskId/events`
- 事件类型建议：`progress`、`log`、`done`、`error`

前端：
- 点击“立即索引”后进入进行中态（按钮禁用 + 文案切换）
- 通过 SSE 实时展示进度条和当前仓库处理状态
- 支持断线重连与异常提示，任务完成后自动刷新平台和仓库列表

---

## 影响范围

| 文件 | 改动类型 |
|---|---|
| `schemas/skill-market-platform.schema.ts` | 新增 |
| `schemas/skill-github-repo.schema.ts` | 新增 |
| `schemas/agent-skill.schema.ts` | 新增 `repoId` 字段 |
| `modules/skills/skill-market.service.ts` | 新增 |
| `modules/skills/skill-market.controller.ts` | 新增 |
| `modules/skills/skill.module.ts` | 注册新 Schema + Service + Controller |
| `frontend/src/types/index.ts` | 新增两个类型 |
| `frontend/src/services/skillMarketService.ts` | 新增 |
| `frontend/src/pages/Skills.tsx` | 新增 Tab |
| `frontend/src/components/SkillMarketPanel.tsx` | 增加 SSE 实时索引进度展示 |

**不受影响**：
- `skill.service.ts`（现有逻辑不变）
- `skill.controller.ts`（现有接口不变）
- `agent_skills` 集合现有数据（仅新增字段，向后兼容）
- Agent 绑定与执行逻辑（不涉及）

---

## 执行顺序

- [ ] Step 1：新增 Layer 1 / Layer 2 Schema，扩展 agent-skill.schema.ts
- [ ] Step 2：实现 SkillMarketService（平台 CRUD + 索引 + 仓库管理 + 导入 + 检索）
- [ ] Step 3：实现 SkillMarketController（REST 接口）
- [ ] Step 4：更新 SkillModule 注册
- [ ] Step 5：新增前端类型定义
- [ ] Step 6：新增 skillMarketService
- [ ] Step 7：Skills.tsx 新增 Skill 市场 Tab
- [ ] Step 8：平台索引升级为任务化 + SSE 实时进度同步

---

## 关键约束

- `skill_github_repos.fullName` 唯一索引，避免重复爬取同一仓库
- 平台索引采用 GitHub API（`/search/repositories`），需注意速率限制（60次/小时未认证，5000次/小时认证）
- 关键词检索优先查本地 Layer 2，减少外部 API 调用
- 导入时 Layer 3 `status` 默认为 `experimental`，不自动变为 `active`
- 删除平台时同步清理关联的 Layer 2 仓库记录
- 现有 `agent_skills` 中 `sourceType='github'` 的历史数据无需迁移，`repoId` 为可选字段
- SSE 连接需考虑网关超时与代理缓冲；若为多实例部署，任务状态建议存储在 Redis 以保证跨实例可见
