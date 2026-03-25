# [已弃用] ORCHESTRATION_EXECUTOR_SELECTION_SKILL_ACTIVATION_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration Executor Selection 重构 + Skill 渐进式激活方案

> 创建时间: 2026-03-17
> 状态: approved
> 优先级: high

## 背景

CTO Orchestrator 编排任务时发现 6 个问题：

1. Plan tasks assignee 违反 planner prompt 中的硬性约束（所有任务应归 CTO，实际被分配给不同 agent）
2. Planner 输出与最终 plan executor 映射脱节（planner 无法控制 executor 分配）
3. Prompt 在 session 中重复出现（task.description 与 user message 重复，浪费 token）
4. orchestration-planner-guard skill 声明已启用但 content 未注入 prompt（形同虚设）
5. 缺少"汇总输出编排结果 JSON"的任务步骤
6. ExecutorSelectionService 仅用关键词文本匹配，不利用 role/tools/skills/permissions 元数据

## 修改范围

### 主线一：ExecutorSelectionService 重构 — 多维能力路由

**文件**: `backend/src/modules/orchestration/services/executor-selection.service.ts`

#### 1.1 扩展输入接口

新增 `ExecutorSelectionContext` 接口，取代原来只接收 `(title, description)` 的签名：

```typescript
interface ExecutorSelectionContext {
  title: string;
  description: string;
  taskType?: 'development' | 'code_review' | 'research' | 'email' | 'planning' | 'general';
  requiredTools?: string[];
  requiredCapabilities?: string[];
  preferredRoleCode?: string;
  plannerAgentId?: string;
  assignmentPolicy?: 'default' | 'lock_to_planner';
}

interface ExecutorSelectionResult {
  executorType: 'agent' | 'employee' | 'unassigned';
  executorId?: string;
  reason: string;
  score?: number;
  capabilityMatch?: {
    toolsCovered: string[];
    toolsMissing: string[];
    capabilitiesCovered: string[];
    capabilitiesMissing: string[];
  };
}
```

#### 1.2 多维评分算法

替换当前的关键词计数算法，引入 4 维评分：

| 维度 | 权重 | 数据来源 | 说明 |
|------|------|---------|------|
| 角色匹配 | 40 | `agent.roleId` -> `AgentRole` | 角色编码与任务类型的兼容性映射 |
| 工具覆盖 | 30 | `agent.tools[]` | 任务所需工具与 agent 工具列表的覆盖率 |
| 能力标签 | 20 | `agent.capabilities` + `role.capabilities` | 合并后的能力标签匹配 |
| 关键词相关性 | 10 | `agent.name/description/capabilities` | 保留原文本匹配但降权 |

#### 1.3 角色-任务类型兼容性映射

```typescript
ROLE_TASK_COMPATIBILITY = {
  'fullstack-engineer': ['development', 'code_review', 'general'],
  'technical-architect': ['code_review', 'planning', 'development'],
  'executive-lead': ['planning', 'general'],
  'devops-engineer': ['development', 'general'],
  'data-analyst': ['research', 'general'],
  'product-manager': ['planning', 'general'],
  'marketing-strategist': ['email', 'research', 'general'],
};
```

#### 1.4 lock_to_planner 策略

当检测到 planner prompt 中有 assignee 锁定信号时，所有 task 直接分配给 plannerAgentId：

锁定信号检测关键词：
- `assignee 必须`
- `all tasks assigned to me`
- `assignmentPolicy=lock_to_planner`
- `enforceSingleAssignee=true`
- `所有.*任务.*归属.*自身`
- `plan tasks.*assignee.*必须.*cto`

#### 1.5 向后兼容

保留旧签名作为方法重载：

```typescript
async selectExecutor(title: string, description: string): Promise<ExecutorSelectionResult>;
async selectExecutor(ctx: ExecutorSelectionContext): Promise<ExecutorSelectionResult>;
```

#### 1.6 新增依赖

- 注入 `AgentRole` model
- `orchestration.module.ts` imports 中添加 AgentRole model 注册

### 主线二：Skill 渐进式激活

**文件**: `backend/apps/agents/src/modules/agents/agent.service.ts`

#### 2.1 设计原则

保持现有渐进式加载架构（enabled skills 缓存只存元数据），增加"激活触发"机制：
- 默认：只注入 skill 摘要（name/description/tags） — 当前行为不变
- 触发激活时：通过已有的 `skillService.getSkillContentById()` 按需加载 content 并注入 prompt
- content 利用已有的三级 Redis 缓存（content:latest + content:hash），不新增缓存层

#### 2.2 激活触发匹配器 shouldActivateSkillContent()

新增私有方法，基于轻量级规则判断是否需要加载 content：

规则优先级：
1. `task.type` 与 skill `tags` 直接匹配
2. skill tags/name 关键词在任务文本中出现 >= 2 次
3. planning 类型任务 + skill 包含 planning/orchestration/guard 标签

#### 2.3 buildMessages 修改

在现有 skill 摘要注入代码之后，遍历 enabledSkills，对匹配的 skill 调用 `getSkillContentById()` 加载 content 并注入为独立 system message。

Token 保护：通过 `SKILL_CONTENT_MAX_INJECT_LENGTH` 环境变量控制截断上限（默认 4000 字符）。

content 加载失败时仅 warn 日志，不阻断任务执行。

### 主线三：其他问题修复

#### 3.1 Prompt 去重

**文件**: `backend/apps/agents/src/modules/agents/agent.service.ts` L1328-1333

在 buildMessages() 中检测 task.description 是否已存在于 previousMessages 的 user 消息中，若重复则只注入 title/type/priority 元信息。

#### 3.2 orchestration.service.ts 调用方适配

**文件**: `backend/src/modules/orchestration/orchestration.service.ts` L264

修改 generatePlanTasksAsync 中的 selectExecutor 调用，传入 ExecutorSelectionContext 结构，包含 plannerAgentId 和 assignmentPolicy。

新增 `detectAssignmentPolicy(prompt)` 私有方法。

#### 3.3 Planner prompt 增加汇总输出指引

**文件**: `backend/src/modules/orchestration/planner.service.ts` L72

在输出规则中追加：
```
7) 若需求涉及编排/分配/通知，最后一个任务应为"汇总输出编排结果 JSON"。
```

#### 3.4 清理 dead code

**文件**: `backend/src/modules/orchestration/orchestration.service.ts` L2149-2256

移除旧版 `private selectExecutor` 方法（历史残留，与 ExecutorSelectionService 重复）。

## 修改文件清单

| # | 文件 | 修改内容 | 优先级 |
|---|------|---------|--------|
| 1 | `backend/src/modules/orchestration/services/executor-selection.service.ts` | 重构：多维能力路由 + 接口扩展 + 向后兼容 | 高 |
| 2 | `backend/apps/agents/src/modules/agents/agent.service.ts` | Skill 渐进式激活 + prompt 去重 | 高 |
| 3 | `backend/src/modules/orchestration/orchestration.service.ts` | 调用方适配 + detectAssignmentPolicy + 清理 dead code | 高 |
| 4 | `backend/src/modules/orchestration/planner.service.ts` | planner prompt 增加输出规则 | 中 |
| 5 | `backend/src/modules/orchestration/orchestration.module.ts` | 新增 AgentRole model 注入 | 高 |

## 风险评估

| 风险 | 影响 | 缓解 |
|------|------|------|
| 多维评分权重不合理导致分配偏差 | 中 | 权重值可通过后续观察 breakdown 日志调优 |
| Skill content 注入增加 token 开销 | 低 | SKILL_CONTENT_MAX_INJECT_LENGTH 限制截断 |
| shouldActivateSkillContent 误触发 | 低 | 匹配规则保守，需 2+ 信号命中 |
| 向后兼容 | 无 | 方法重载保证旧签名正常工作 |

## 验收标准

- [ ] CTO agent 编排计划时，lock_to_planner 策略生效，所有 task assignee 归 CTO
- [ ] orchestration-planner-guard skill 的 content 在 planning 任务中被激活注入
- [ ] task.description 与 user message 重复时不再双重注入
- [ ] 非 lock 场景下，agent 按角色+工具+能力多维评分分配
- [ ] lint + typecheck 通过
