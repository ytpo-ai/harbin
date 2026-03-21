---
在 /Users/van/Workspace/harbin 项目中，深入分析 skill 技能系统的完整机制。我需要了解：

1. skill.service.ts 的完整内容（特别是 skill content 的加载、缓存、更新机制）
2. agent.service.ts 中所有引用 skill 的地方（搜索 skill, enabledSkills, getEnabledSkills）
3. 是否存在"按需加载 skill content"的逻辑（即不是一次性全部加载，而是在特定条件下才加载 content）
4. skill 的 metadata 结构（是否有 triggers, activation conditions 等字段）
5. agent-executor-runtime.service.ts 中是否有 skill 相关的执行逻辑
6. 是否有 skill 的 proficiency 评估机制（beginner/intermediate/expert）
7. 前端 skill 管理的相关代码（搜索 skill 相关的前端组件和 API 调用）
8. skill content 的实际数据示例（如果能通过代码推断的话）
9. 是否有 skill 激活/触发的条件匹配逻辑（比如根据任务类型决定是否激活某个 skill）

请返回所有关键文件路径、行号和代码片段。搜索深度：very thorough
---

# Skill 技能系统完整机制分析

## 一、核心文件清单

| # | 文件 | 用途 |
|---|------|------|
| 1 | `/Users/van/Workspace/harbin/backend/apps/agents/src/schemas/agent-skill.schema.ts` | Skill 数据模型定义 (Mongoose Schema) |
| 2 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/skills/skill.service.ts` | Skill 核心业务逻辑服务 (725行) |
| 3 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/skills/skill.controller.ts` | Skill REST API 控制器 |
| 4 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/skills/skill-doc-loader.service.ts` | Skill 文档加载服务（扫描 docs/skill 并解析 frontmatter + content） |
| 5 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/skills/skill.module.ts` | Skill 模块注册 |
| 6 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/skills/skill.service.spec.ts` | 单测 |
| 7 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent.service.ts` | Agent 服务 -- 含 skill 加载/注入 prompt 的核心逻辑 |
| 8 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent-executor-runtime.service.ts` | Agent 运行时执行服务 (不含 skill 逻辑) |
| 9 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/tools/skill-tool-handler.service.ts` | MCP 工具侧 skill 操作 handler |
| 10 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/tools/tool.service.ts` | 工具分发 -- 含 skill-master 工具路由 |
| 11 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/memos/identity-aggregation.service.ts` | 身份聚合 -- 含 skill 矩阵输出 |
| 12 | `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/memos/evaluation-aggregation.service.ts` | 评估聚合 -- 含 skill proficiency 统计 |
| 13 | `/Users/van/Workspace/harbin/backend/src/shared/schemas/agent.schema.ts` | Agent 模型 -- skills 字段定义 (line 72) |
| 14 | `/Users/van/Workspace/harbin/backend/scripts/migrate-skill-content-to-db.ts` | 数据迁移脚本: 从磁盘 .md 文件迁入 DB |
| 15 | `/Users/van/Workspace/harbin/frontend/src/services/skillService.ts` | 前端 Skill API 服务层 |
| 16 | `/Users/van/Workspace/harbin/frontend/src/pages/Skills.tsx` | 前端 Skill 管理页面 (1022行) |
| 17 | `/Users/van/Workspace/harbin/frontend/src/types/index.ts` | 前端 Skill 类型定义 (line 118-143) |
| 18 | `/Users/van/Workspace/harbin/docs/skill/meeting-sensitive-skill.md` | Skill content 实际数据示例 |
| 19 | `/Users/van/Workspace/harbin/docs/skill/orchestration-planner-guard.md` | Skill content 实际数据示例 |
| 20 | `/Users/van/Workspace/harbin/data/skills/library/meeting-orchestration-smart.md` | 磁盘同步生成的 skill 文档 |

---

## 二、Skill 数据模型 (Schema)

**文件**: `/Users/van/Workspace/harbin/backend/apps/agents/src/schemas/agent-skill.schema.ts` (87行)

```typescript
// line 6-7: 类型定义
export type SkillSourceType = 'manual' | 'github' | 'web' | 'internal';
export type SkillStatus = 'active' | 'experimental' | 'deprecated' | 'disabled';

// line 9-82: Schema 字段
@Schema({ timestamps: true, collection: 'agent_skills' })
export class Skill {
  id: string;            // 唯一标识 (UUID)
  name: string;          // 技能名称
  slug: string;          // URL 友好标识 (lowercase, trim)
  description: string;   // 描述
  category: string;      // 分类 (default: 'general')
  tags: string[];        // 标签数组
  sourceType: SkillSourceType;  // 来源类型
  sourceUrl?: string;    // 来源 URL
  provider: string;      // 提供者 (default: 'system')
  version: string;       // 版本号 (default: '1.0.0')
  status: SkillStatus;   // 状态
  confidenceScore: number; // 置信度分数 (0-100, default: 50)
  usageCount: number;    // 使用次数
  discoveredBy: string;  // 发现者
  lastVerifiedAt?: Date; // 最后验证时间
  metadata?: Record<string, any>;  // 自由结构元数据
  content?: string;      // 正文内容 (Markdown)
  contentType?: string;  // 内容类型 (default: 'text/markdown')
  contentHash?: string;  // SHA256 内容哈希
  contentSize?: number;  // 内容字节大小
  contentUpdatedAt?: Date; // 内容更新时间
  metadataUpdatedAt?: Date; // 元数据更新时间
}
```

**关键发现**: Schema 中**没有** triggers、activation conditions、proficiencyLevel 等字段。metadata 是 `Record<string, any>` 自由结构，实际数据中可包含任意内容。

Agent 侧的 skills 字段定义 (`agent.schema.ts` line 71-72):
```typescript
@Prop({ type: [String], default: [] })
skills?: string[]; // 已启用的技能ID列表 -- 存储的是 skill UUID 数组
```

---

## 三、skill.service.ts 完整机制

**文件**: `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/skills/skill.service.ts` (725行)

### 3.1 三级 Redis 缓存机制

该服务实现了精细的三级缓存体系:

| 缓存层级 | Key 格式 | TTL | 用途 |
|---------|----------|-----|------|
| **Index 缓存** | `skill:index:{slug}` | 1800s (30min) | 存储 skill 摘要 (id/slug/name/desc/status/category/tags/provider/version/metadata) -- **不含 content** |
| **Detail 缓存** | `skill:detail:{skillId}` | 900s (15min) | 存储完整 skill 对象 (可选含 content) |
| **Content 缓存** | `skill:content:{skillId}:{contentHash}` + `skill:content:latest:{skillId}` | 900s (15min) | 存储 content 正文，通过 contentHash 做版本化 |

TTL 可通过环境变量覆盖 (line 62-64):
```typescript
SKILL_INDEX_CACHE_TTL_SECONDS    // default 1800
SKILL_DETAIL_CACHE_TTL_SECONDS   // default 900
SKILL_CONTENT_CACHE_TTL_SECONDS  // default 900
```

### 3.2 Content 加载机制 -- "按需加载"

**这是整个系统的核心设计: skill content 是按需加载的，不是一次性全部加载。**

**证据 1**: `getSkillById()` (line 162-177) -- 默认排除 content
```typescript
async getSkillById(skillId: string, options?: SkillReadOptions): Promise<Skill> {
    const includeContent = options?.includeContent === true;  // 默认 false
    if (!includeContent) {
      const cached = await this.loadSkillDetailFromCache(skillId); // 先查缓存
      if (cached) return cached as Skill;
    }
    const projection = this.buildSkillProjection({ includeContent, ... });
    // projection 默认为 { content: 0 } -- 排除 content
    const skill = await this.skillModel.findOne({ id: skillId }, projection).exec();
    ...
}
```

**证据 2**: `buildSkillProjection()` (line 529-538) -- 默认排除 content 和 metadata
```typescript
private buildSkillProjection(options?: SkillReadOptions): Record<string, 0> | undefined {
    const projection: Record<string, 0> = {};
    if (options?.includeContent !== true) {
      projection.content = 0;  // 默认排除
    }
    if (options?.includeMetadata !== true) {
      projection.metadata = 0;  // 默认排除
    }
    return Object.keys(projection).length ? projection : undefined;
}
```

**证据 3**: `getSkillContentById()` (line 180-228) -- 独立的 content 获取方法
```typescript
async getSkillContentById(skillId: string): Promise<{
    id: string; content: string; contentType: string;
    contentHash: string; contentSize: number; contentUpdatedAt?: Date;
}> {
    // 先查 Redis: skill:content:latest:{id} -> hash -> skill:content:{id}:{hash}
    const latestHash = await this.redisService.get(this.skillContentLatestKey(skillId));
    if (latestHash) {
      const cached = await this.redisService.get(this.skillContentCacheKey(skillId, latestHash));
      if (cached) { /* 从缓存返回 */ }
    }
    // 缓存 miss -> 查 DB (仅投影 content 相关字段)
    const skill = await this.skillModel
      .findOne({ id: skillId }, { id:1, content:1, contentType:1, contentHash:1, contentSize:1, contentUpdatedAt:1 })
      .exec();
    // 计算 hash 并回填缓存
    await this.cacheSkillContent(skillId, contentHash, result);
    return result;
}
```

**证据 4**: 列表查询同样排除 content (line 126-132, 135-160)
```typescript
async getAllSkills(filters?, options?): Promise<Skill[]> {
    const projection = this.buildSkillProjection({
      includeContent: options?.includeContent,      // 调用方需显式传 true
      includeMetadata: options?.includeMetadata !== false,
    });
    return this.skillModel.find(query, projection)...
}
```

### 3.3 Content Hash 版本化

Content 更新时会计算 SHA256 hash (line 546-548):
```typescript
private computeContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}
```

Redis 缓存使用双 key 结构实现内容版本化:
- `skill:content:latest:{skillId}` -> 存储最新的 contentHash
- `skill:content:{skillId}:{contentHash}` -> 存储具体内容

这意味着当 content 更新时，旧版本缓存自然失效(hash 变了)，新版本缓存被写入。

### 3.4 缓存失效策略

`invalidateSkillCaches()` (line 631-635):
```typescript
private async invalidateSkillCaches(skill: Skill): Promise<void> {
    await this.redisService.del(this.skillIndexCacheKey(skill.slug));
    await this.redisService.del(this.skillDetailCacheKey(skill.id));
    await this.invalidateSkillContentCache(skill.id, (skill as any).contentHash);
}
```

`invalidateSkillContentCache()` (line 620-629):
```typescript
// 删除旧 hash 的缓存、latest hash 指针、以及 latest 指向的缓存
```

`invalidateEnabledSkillCacheBySkillIds()` (line 645-657):
```typescript
// 当 skill 被更新/删除时，找到所有绑定了该 skill 的 agent，清除它们的 enabled-skills 缓存
```

### 3.5 技能发现机制 -- discoverSkillsFromInternet()

Line 392-494: 从 GitHub API 搜索仓库，自动创建/更新 skill 记录:
```typescript
const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${query} agent skill`)}&sort=stars&order=desc&per_page=${maxResults}`;
```
- 根据 stars 数量计算 confidenceScore: `35 + floor(stars/200)` (max 95)
- 支持 dryRun 模式
- 已存在的 skill (按 slug+provider+version 匹配) 会更新而不重复创建

### 3.6 Agent 绑定机制

`assignSkillToAgent()` (line 306-338):
```typescript
// enabled=true  -> $addToSet: { skills: skillId }  (追加到 agent.skills 数组)
// enabled=false -> $pull: { skills: skillId }       (从 agent.skills 数组移除)
// 触发 memo 事件: 'agent.skill_changed'
// 清除 agent 的 enabled-skills 缓存
```

### 3.7 文档同步机制（2026-03 更新）

当前为“文档主导”模式：
- 同步入口：`POST /skills/docs/sync`
- 扫描目录：默认 `{workspaceRoot}/docs/skill`，可通过 `SKILL_DOCS_DIR` 覆盖
- 同步策略：按 `slug` upsert 到 `agent_skills`（insert / update / skip）
- Skill 正文来自文档主体 Markdown，metadata/tags/planningRules 等来自 frontmatter

---

## 四、agent.service.ts 中所有 Skill 引用

**文件**: `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent.service.ts` (2471行)

### 4.1 EnabledAgentSkillContext 接口 (line 113-119)

```typescript
interface EnabledAgentSkillContext {
  id: string;
  name: string;
  description: string;
  tags: string[];
  proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
}
```

### 4.2 Agent 创建时的 skill 校验 (line 242, 259)

```typescript
// line 242: 规范化 skill IDs
skills: this.normalizeSkillIds(agentData.skills || []),
// line 259: 确保所有 skill 存在
await this.ensureSkillsExist(normalizedData.skills || []);
```

### 4.3 Agent 更新时的 skill 校验 (line 373-378)

```typescript
const hasSkillsField = Object.prototype.hasOwnProperty.call(updates, 'skills');
if (hasSkillsField) {
  const normalizedSkills = this.normalizeSkillIds(Array.isArray(updates.skills) ? updates.skills : []);
  await this.ensureSkillsExist(normalizedSkills);
  normalizedUpdates.skills = normalizedSkills;
}
```

### 4.4 任务执行时加载 enabled skills (line 782-786, 1011-1012)

**详细模式** (line 782):
```typescript
const enabledSkills = await this.getEnabledSkillsForAgent(agent, agentId);
this.logger.log(
  `[task_skills] taskId=${taskId} enabledSkills=${enabledSkills.length} skillNames=${enabledSkills.map((item) => item.name).join('|') || 'none'}`,
);
const messages = await this.buildMessages(agent, task, agentContext, enabledSkills);
```

**流式模式** (line 1011-1012):
```typescript
const enabledSkills = await this.getEnabledSkillsForAgent(agent, agentId);
const messages = await this.buildMessages(agent, task, agentContext, enabledSkills);
```

### 4.5 Skill 注入到 System Prompt -- buildMessages() (line 1313-1358)

```typescript
private async buildMessages(
    agent: Agent, task: Task, context: AgentContext,
    enabledSkills: EnabledAgentSkillContext[],
): Promise<ChatMessage[]> {
    ...
    if (enabledSkills.length > 0) {
      const skillLines = enabledSkills
        .map((skill) =>
          `- ${skill.name} (id=${skill.id}, proficiency=${skill.proficiencyLevel}) | description=${skill.description} | tags=${(skill.tags || []).join(', ') || 'N/A'}`,
        )
        .join('\n');

      messages.push({
        role: 'system',
        content:
          `Enabled Skills for this agent:\n${skillLines}\n\n` +
          '请优先基于以上已启用技能的能力边界来拆解与执行任务，并在输出中体现对应技能的方法论。',
        timestamp: new Date(),
      });
    }
    ...
}
```

这个 prompt 注入会告诉 LLM agent 拥有哪些 skill，并要求它"优先基于已启用技能的能力边界来拆解与执行任务"。

### 4.6 getEnabledSkillsForAgent() -- 核心加载逻辑 (line 1453-1505)

```typescript
private async getEnabledSkillsForAgent(agent: Agent, agentId: string): Promise<EnabledAgentSkillContext[]> {
    // 1. 尝试从 Redis 缓存加载 (key: agent:enabled-skills:{agentId})
    for (const candidateAgentId of candidateAgentIds) {
      const cached = await this.redisService.get(this.agentEnabledSkillCacheKey(candidateAgentId));
      if (cached) { return parsed.items as EnabledAgentSkillContext[]; }
    }

    // 2. 从 agent.skills 取 skill ID 列表
    const agentSkillIds = this.uniqueStrings((agent.skills || []).filter(Boolean));
    if (!agentSkillIds.length) return [];

    // 3. 查 DB -- 仅加载 status 为 active 或 experimental 的 skill
    const skills = await this.skillModel
      .find({ id: { $in: agentSkillIds }, status: { $in: ['active', 'experimental'] } })
      .exec();

    // 4. 映射为 EnabledAgentSkillContext -- proficiencyLevel 硬编码为 'beginner'
    const contexts: EnabledAgentSkillContext[] = skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags || [],
      proficiencyLevel: 'beginner',  // <<< 关键: 始终是 beginner
    }));

    // 5. 写入 Redis 缓存
    await Promise.all(candidateAgentIds.map((id) =>
      this.redisService.set(this.agentEnabledSkillCacheKey(id), payload, AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS)
    ));
    return contexts;
}
```

**缓存 TTL** (line 174):
```typescript
const AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS = Math.max(60, Number(process.env.AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS || 300));
// 默认 5 分钟
```

### 4.7 任务结果中记录使用的 skills (line 924-933, 1195-1202)

```typescript
task.messages.push({
  role: 'assistant',
  content: response,
  metadata: {
    usedSkillIds: enabledSkills.map((item) => item.id),
    usedSkillNames: enabledSkills.map((item) => item.name),
    usedSkills: enabledSkills.map((item) => ({
      id: item.id,
      name: item.name,
      proficiencyLevel: item.proficiencyLevel,
    })),
  },
});
```

### 4.8 ensureSkillsExist() (line 1897-1907)

```typescript
private async ensureSkillsExist(skillIds: string[]): Promise<void> {
    const skills = await this.skillModel.find({ id: { $in: normalizedSkillIds } }).select({ id: 1 }).lean().exec();
    const existingIds = new Set(skills.map((item: any) => String(item.id).trim()));
    const missing = normalizedSkillIds.filter((skillId) => !existingIds.has(skillId));
    if (missing.length) throw new BadRequestException(`Invalid skills: ${missing.join(', ')}`);
}
```

---

## 五、是否存在"按需加载 skill content"的逻辑

**结论: 是的，系统明确实现了按需加载。**

证据汇总:

1. **`getSkillById()` 默认不加载 content** (line 163: `includeContent = options?.includeContent === true` -- 默认 false)

2. **`getSkillContentById()` 是独立方法** (line 180-228): 仅在 controller 的 `GET :id/content` 路由调用

3. **列表查询 `getAllSkills()`/`getSkillsPaged()` 默认排除 content** (通过 projection `{ content: 0 }`)

4. **`getEnabledSkillsForAgent()` 不加载 content** (line 1477-1479): 查询 DB 时没有使用 projection 但返回的 `EnabledAgentSkillContext` 只映射了 `id/name/description/tags/proficiencyLevel`，**content 不会被传入 prompt**

5. **前端 skill 详情查看时才加载 content** (Skills.tsx line 142-146):
   ```typescript
   const { data: activeSkillDetail } = useQuery(
     ['skill-detail', activeSkillId],
     () => skillService.getSkillById(activeSkillId as string, { includeContent: true }),
     { enabled: !!activeSkillId },
   );
   ```

6. **Controller 层也体现按需** (skill.controller.ts line 114-118):
   ```typescript
   @Get(':id')
   async getSkill(@Param('id') id: string, @Query('includeContent') includeContent?: string) {
     const shouldIncludeContent = includeContent === 'true' || includeContent === '1';
     return this.skillService.getSkillById(id, { includeContent: shouldIncludeContent });
   }
   ```

**重要发现: skill content 在任务执行时不会被注入到 agent 的 prompt 中。** `buildMessages()` 只注入了 skill 的 name/id/proficiencyLevel/description/tags 摘要信息，不包含 content 正文。Content 目前仅作为知识存储存在，供人工查看或后续扩展使用。

---

## 六、Skill Metadata 结构

Schema 定义 (agent-skill.schema.ts line 62-63):
```typescript
@Prop({ type: Object })
metadata?: Record<string, any>;  // 完全自由结构
```

**实际数据中 metadata 的使用模式:**

### 6.1 发现入库时的 metadata (skill.service.ts line 444-449):
```typescript
metadata: {
  stars: Number(item?.stargazers_count || 0),
  language: item?.language || 'unknown',
  fullName: item?.full_name || '',
  discoveredAt: new Date().toISOString(),
}
```

### 6.2 前端保存时的 metadata (Skills.tsx line 756, 1008):
```typescript
metadata: { markdown: metadataText.trim() }
// 前端统一将 metadata 序列化为 { markdown: string } 格式
```

### 6.3 Skill content 文档中的 YAML frontmatter metadata

**这是最丰富的 metadata 定义，但存储在 content 字段中，不在 Schema 的 metadata 字段里。**

`/Users/van/Workspace/harbin/docs/skill/meeting-sensitive-skill.md` (line 1-30):
```yaml
---
name: meeting-sensitive-planner
description: 在会议聊天中识别计划信号，先建议后执行...
metadata:
  author: opencode
  version: "0.1.0"
  language: zh-CN
  applies_to:           # <<< 适用场景 (类似 activation conditions)
    - meeting-chat
    - multi-agent-collaboration
  capabilities:         # <<< 能力标签
    - semantic-signal-detection
    - plan-orchestration
    - tool-and-agent-capability-awareness
    - scheduling
  plan_types:           # <<< 计划类型
    - one-time
    - recurring
    - scheduled
  required_tools:       # <<< 依赖工具
    - builtin.sys-mg.mcp.orchestration.create-plan
    - builtin.sys-mg.mcp.orchestration.run-plan
    - builtin.sys-mg.mcp.orchestration.create-schedule
    - builtin.sys-mg.mcp.orchestration.update-schedule
  approval_policy:      # <<< 审批策略
    suggest_before_execute: true
    require_user_approval_to_create: true
    require_user_approval_to_run: true
  risk_level: medium
---
```

**结论: Schema 中没有 triggers/activation conditions 等结构化字段。** 这类信息以自由文本形式存在于 content (Markdown + YAML frontmatter) 中，供 LLM 理解使用，但系统代码层面不做结构化解析。

---

## 七、agent-executor-runtime.service.ts 中的 Skill 逻辑

**文件**: `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent-executor-runtime.service.ts` (157行)

**结论: agent-executor-runtime.service.ts 中没有任何 skill 相关逻辑。**

该服务仅负责:
- 解析 runtimeAgentId
- 构建 model config
- 启动/完成/失败/释放 runtime execution
- 追加 system messages 到 session

所有 skill 加载和注入逻辑都在 `agent.service.ts` 中完成，在调用 `agentExecutionService.startRuntimeExecution()` 之前。

---

## 八、Proficiency 评估机制

**结论: 系统定义了四级 proficiency (`beginner/intermediate/advanced/expert`)，但目前全部硬编码为 `beginner`。不存在动态评估机制。**

证据:

### 8.1 类型定义 (agent.service.ts line 118):
```typescript
proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
```

### 8.2 实际赋值 -- 始终 beginner

**agent.service.ts line 1486** (getEnabledSkillsForAgent):
```typescript
proficiencyLevel: 'beginner',  // 硬编码
```

**identity-aggregation.service.ts line 134** (getAgentSkills):
```typescript
proficiencyLevel: 'beginner',  // 硬编码
```

**evaluation-aggregation.service.ts line 207** (getSkillStatistics):
```typescript
proficiencyLevel: 'beginner',  // 硬编码
```

### 8.3 Proficiency 统计框架已存在但无实际数据

evaluation-aggregation.service.ts line 212-217:
```typescript
const proficiencyCount = {
  expert: skillsWithCategory.filter((s) => s.proficiencyLevel === 'expert').length,     // 永远是 0
  advanced: skillsWithCategory.filter((s) => s.proficiencyLevel === 'advanced').length,  // 永远是 0
  intermediate: skillsWithCategory.filter((s) => s.proficiencyLevel === 'intermediate').length, // 永远是 0
  beginner: skillsWithCategory.filter((s) => s.proficiencyLevel === 'beginner').length,  // 等于 total
};
```

identity-aggregation.service.ts line 225-237 中生成的 "技能矩阵" Markdown 表格包含熟练度列，但所有行都会显示 "初级"。

**总结**: proficiency 是预留的评估框架，四级分类已定义且在输出中被消费(prompt注入、memo报告)，但缺少动态评估引擎来根据使用情况自动升级 proficiency level。

---

## 九、前端 Skill 管理相关代码

### 9.1 前端 API 服务层

**文件**: `/Users/van/Workspace/harbin/frontend/src/services/skillService.ts` (91行)

提供以下 API 调用:
| 方法 | HTTP | 路径 | 用途 |
|------|------|------|------|
| `getSkills()` | GET | `/skills` | 获取 skill 列表 |
| `getSkillsPaged()` | GET | `/skills` | 分页获取 |
| `createSkill()` | POST | `/skills` | 创建 skill |
| `updateSkill()` | PUT | `/skills/{id}` | 更新 skill |
| `getSkillById()` | GET | `/skills/{id}?includeContent=true` | 获取详情(按需加载 content) |
| `deleteSkill()` | DELETE | `/skills/{id}` | 删除 |
| `assignSkillToAgent()` | POST | `/skills/assign` | 绑定 agent |
| `getAgentSkills()` | GET | `/skills/agents/{agentId}` | 获取 agent 的 skills |
| `getSkillAgents()` | GET | `/skills/skills/{skillId}/agents` | 获取 skill 绑定的 agents |
| `getAllSkillAgents()` | GET | `/skills/all-skill-agents` | 获取所有 skill-agent 绑定关系 |
| `discoverSkills()` | POST | `/skills/manager/discover` | GitHub 发现 |
| `syncDocs()` | POST | `/skills/docs/sync` | 同步文档到 DB |

### 9.2 前端页面

**文件**: `/Users/van/Workspace/harbin/frontend/src/pages/Skills.tsx` (1022行)

包含四个组件:

1. **`Skills`** (主页面, line 81-539): 技能库列表 + 筛选(status/category/search) + 分页 + 操作入口
2. **`SkillDetailDrawer`** (line 542-821): 右侧抽屉，两个 tab:
   - "详情" tab: 编辑 name/description/category/tags/metadata/content/sourceType/provider/version/status/confidenceScore/discoveredBy
   - "Agent 绑定" tab: 选择 agent 绑定，查看已绑定 agents
3. **`SkillDiscoveryDrawer`** (line 823-898): AgentSkillManager 检索抽屉 (query/maxResults/sourceType)
4. **`SkillFormModal`** (line 901-1020): 新增 Skill 弹窗

前端使用 **乐观更新** 模式 (line 215-250): updateSkillMutation 使用 `onMutate` 先本地更新缓存，失败时 rollback。

### 9.3 前端类型定义

**文件**: `/Users/van/Workspace/harbin/frontend/src/types/index.ts` line 118-143:
```typescript
export interface Skill {
  id: string; name: string; slug: string; description: string;
  category: string; tags: string[];
  sourceType: 'manual' | 'github' | 'web' | 'internal';
  sourceUrl?: string; provider: string; version: string;
  status: 'active' | 'experimental' | 'deprecated' | 'disabled';
  confidenceScore: number; usageCount?: number;
  discoveredBy?: string; lastVerifiedAt?: string;
  metadata?: Record<string, any>;
  content?: string; contentType?: string; contentHash?: string;
  contentSize?: number; contentUpdatedAt?: string; metadataUpdatedAt?: string;
  createdAt?: string; updatedAt?: string;
}
```

---

## 十、Skill Content 实际数据示例

### 10.1 磁盘生成的 skill 文档 (由 SkillDocSyncService 生成)

**文件**: `/Users/van/Workspace/harbin/data/skills/library/meeting-orchestration-smart.md`
```markdown
# Skill: meeting orchestration smart
- id: `ff729020-b1b0-4982-a146-7ea3b3b2f556`
- slug: `meeting-orchestration-smart`
- category: general
- status: active
- version: 1.0.0
- provider: internal
- sourceType: manual
- confidenceScore: 80
- tags: meeting, orchestration, schedule

## Description
在会议聊天中识别计划信号，先建议后执行，并在同意后创建一次性/周期/定时计划
```

### 10.2 完整的 skill content 文档 (手工编写的知识文档)

**文件**: `/Users/van/Workspace/harbin/docs/skill/meeting-sensitive-skill.md` (204行)
- YAML frontmatter 定义 metadata (applies_to/capabilities/plan_types/required_tools/approval_policy/risk_level)
- 正文包含: 目标、适用场景与触发信号、触发抑制规则、计划类型与能力感知、能力感知协议、MCP 参数模板、工作流

**文件**: `/Users/van/Workspace/harbin/docs/skill/orchestration-planner-guard.md` (148行)
- YAML frontmatter 定义 metadata (applies_to/capabilities/risk_level)
- 正文包含: 设计意图、分配策略模型、能力检查、Prompt Contract、工作流、验证清单、拒绝条件、推荐输出结构

### 10.3 数据迁移脚本

**文件**: `/Users/van/Workspace/harbin/backend/scripts/migrate-skill-content-to-db.ts` (161行)

从 `data/skills/library/*.md` 目录读取 markdown 文件，通过 slug 匹配 DB 中的 skill 记录，将文件内容写入 `content` 字段并计算 contentHash。这表明 content 最初可能存储在文件系统中，后来迁移到 MongoDB。

---

## 十一、Skill 激活/触发条件匹配逻辑

**结论: 系统中不存在基于任务类型的条件匹配/自动激活逻辑。**

当前的 skill 激活机制是**完全静态的**:

1. **绑定方式**: 人工通过前端或 API 将 skill ID 添加到 `agent.skills[]` 数组
2. **加载条件**: `getEnabledSkillsForAgent()` 仅做两个过滤:
   - skill ID 存在于 `agent.skills[]` 中
   - skill 的 `status` 为 `active` 或 `experimental` (line 1478)
3. **无条件匹配**: 不根据 task.type、task.priority、context 等动态决定激活哪些 skill
4. **无 trigger 机制**: grep 搜索 `trigger.*skill|skill.*trigger|activation.*skill|skill.*condition` 在整个代码库中无匹配

**虽然 skill content 文档中定义了丰富的触发条件** (如 meeting-sensitive-skill.md 中的 "触发信号"、"触发抑制"、"适用场景")，**但这些条件仅作为 natural language 存在于 content 中，供 LLM 自主理解和遵循，系统代码不做任何结构化解析或条件匹配。**

---

## 十二、MCP 工具侧的 Skill 操作

### 12.1 工具路由 (tool.service.ts line 1192-1195)

```typescript
case 'builtin.sys-mg.mcp.skill-master.list-skills':
    return this.skillToolHandler.listSkillsByTitle(parameters);
case 'builtin.sys-mg.mcp.skill-master.create-skill':
    return this.skillToolHandler.createSkillByMcp(parameters);
```

### 12.2 skill-tool-handler.service.ts (128行)

两个方法:
- `listSkillsByTitle()`: 支持 title/search/status/category/includeMetadata/limit/page 参数，调用 `skillService.getSkillsPaged()`
- `createSkillByMcp()`: 支持通过 MCP 工具创建 skill，discoveredBy 标记为 `'SkillMasterMCP'`

这意味着 Agent 可以通过 tool calling 自主创建和查询 skills。

---

## 十三、Gateway 路由

**文件**: `/Users/van/Workspace/harbin/backend/apps/gateway/src/gateway-proxy.service.ts` line 40:
```typescript
originalUrl.startsWith('/api/skills') ||
```
gateway 将 `/api/skills` 路由转发到 agents 微服务。

---

## 总结: 系统架构图

```
                                    ┌──────────────────────────┐
                                    │   Frontend (Skills.tsx)  │
                                    │  - 技能库 CRUD 管理       │
                                    │  - Agent 绑定             │
                                    │  - GitHub 发现            │
                                    │  - Content 按需加载       │
                                    └──────────┬───────────────┘
                                               │ HTTP API
                                               ▼
                                    ┌──────────────────────────┐
                                    │  SkillController (REST)  │
                                    │  GET/POST/PUT/DELETE     │
                                    │  /skills/*               │
                                    └──────────┬───────────────┘
                                               │
                                               ▼
┌──────────────────┐           ┌──────────────────────────────────────────┐
│  SkillToolHandler │──────────▶│          SkillService (核心)              │
│  (MCP 工具调用)    │           │  - createSkill / updateSkill / delete    │
└──────────────────┘           │  - getSkillById (按需加载 content)        │
                               │  - getSkillContentById (独立 content API)│
                               │  - assignSkillToAgent (绑定/解绑)        │
                               │  - discoverSkillsFromInternet (GitHub)   │
                               │  - 三级 Redis 缓存 (index/detail/content)│
                               └─────┬──────────┬────────────┬───────────┘
                                     │          │            │
                          ┌──────────▼──┐  ┌────▼─────┐  ┌──▼──────────────┐
                          │  MongoDB    │  │  Redis   │  │SkillDocSyncSvc  │
                          │agent_skills │  │ 3级缓存  │  │ 磁盘 .md 同步    │
                          └─────────────┘  └──────────┘  └─────────────────┘

                                        (消费方)
                               ┌──────────────────────────┐
                               │     AgentService          │
                               │ getEnabledSkillsForAgent()│
                               │ → 查 agent.skills[]       │
                               │ → 过滤 status=active|exp  │
                               │ → proficiency='beginner'  │
                               │ → Redis 缓存 (5min)       │
                               │                           │
                               │ buildMessages()           │
                               │ → 注入 system prompt:     │
                               │   name/id/proficiency/    │
                               │   description/tags        │
                               │ → 不注入 content          │
                               └──────────┬───────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
            ┌──────────────┐    ┌──────────────────┐   ┌──────────────────┐
            │IdentityAggr. │    │EvaluationAggr.   │   │ 任务执行结果      │
            │ 技能矩阵输出   │    │ proficiency统计   │   │ metadata记录      │
            │ (memo 文档)   │    │ (全部 beginner)   │   │ usedSkillIds     │
            └──────────────┘    └──────────────────┘   └──────────────────┘
```

**核心发现总结:**

1. **按需加载 content**: 明确实现，默认排除 content 字段，独立 API 获取
2. **三级缓存**: index/detail/content 分层缓存，content 使用 hash 版本化
3. **Proficiency 框架存在但未激活**: 四级分类已定义，但全部硬编码为 beginner
4. **无条件激活/触发**: 所有绑定是静态的 agent.skills[] 数组，无动态匹配
5. **Content 不注入 prompt**: skill content (markdown 文档) 不参与任务执行的 prompt，仅注入摘要
6. **Triggers 在 content 中定义**: 触发条件以自然语言存在于 content 文档的 YAML frontmatter 和正文中，依赖 LLM 自主理解
