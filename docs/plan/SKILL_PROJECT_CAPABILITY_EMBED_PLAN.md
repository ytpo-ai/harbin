# Plan: 项目能力认知 Skill 内嵌方案

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [AGENT_SKILL](../feature/AGENT_SKILL.md)、[PROJECT_INCUBATION](../feature/PROJECT_%20INCUBATION.md) |
| 状态 | draft |
| 优先级 | medium |
| 创建日期 | 2026-04-23 |

## 2. 背景

### 问题

当 CTO 或孵化项目负责人需要 Agent 基于"项目能力"进行交互时（如评估资源分配、制定计划、回答项目现状问题），Agent 当前获取项目知识的路径效率很低：

1. **Native 通道**：Agent 通过 `repo_read`（`cat docs/feature/XXX.md`）逐文件读取，每读一个文件消耗一次完整的 LLM tool_call 循环（LLM 生成 → 后端执行 → 结果回传 → LLM 再思考）。读 10 个功能文档 = 10 次 round-trip + 大量 token 消耗。
2. **`docs_read` 工具**：虽然能批量返回，但"全量扫描 + 关键词粗筛"导致返回内容噪音大。CTO 不需要看 schema 字段定义，项目负责人不需要看无关模块。
3. **OpenCode 通道**：虽然内部读文件不走 tool_call，但仍需 Agent 自行从原始文档中提炼能力摘要，浪费推理 token。

### 核心判断

- 项目能力认知**不是每个 session 都需要**的——不应该作为 context layer 每次注入
- 应该是**按需触发**的——通过 skill 激活条件控制注入时机
- Agent 需要的是**预编译好的能力摘要**，而不是每次从原始文档自行提炼

### 方案选型

| 方案 | 说明 | 判定 |
|------|------|------|
| 新增 context layer 每次注入 | 在 context assembler 中新增 project-knowledge layer | 否决——不是每个 session 都需要 |
| 新增专用 tool 从 DB 查询 | 新建 project-capability tool 按 projectId 返回能力清单 | 备选——仍需 1 次 tool_call |
| **Skill content 内嵌** | 将能力摘要写入 skill content，激活时自动注入 prompt | **采用——零 tool_call，激活即可用** |

## 3. 目标

1. CTO Agent 在需要了解平台全局能力时，通过 skill 激活自动获得平台能力总览（零 tool_call）
2. 孵化项目负责人 Agent 在需要了解本项目能力时，通过 skill 激活自动获得项目能力摘要（零 tool_call）
3. 能力摘要通过 `docs/skill/` → `docs/sync` 机制维护更新，无需改动 schema 或激活引擎
4. 利用现有 skill 激活 tag 机制（`roleInPlan` / `domainType`）控制注入时机，避免无关 session 被注入

## 4. 执行步骤

1. [x] 编写 `docs/skill/platform-capability-overview.md`（CTO 视角平台能力总览 skill）
2. [ ] 编写 `docs/skill/incubation-project-handbook.md`（孵化项目负责人视角项目能力手册 skill 模板）
3. [ ] 执行 `POST /skills/docs/sync` 将两份 skill 文档同步入库
4. [ ] 将 `platform-capability-overview` skill 绑定给 CTO Agent
5. [ ] 将 `incubation-project-handbook` skill 绑定给各孵化项目负责人 Agent
6. [ ] 验证：CTO Agent 在规划场景中 skill 激活并注入能力摘要
7. [ ] 验证：孵化项目负责人 Agent 在项目规划场景中 skill 激活并注入项目能力摘要

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | CTO 平台能力总览 Skill 文档编写与同步 | [链接](../requirement/SKILL_PROJECT_CAPABILITY_REQ-001_PLATFORM_OVERVIEW.md) | draft |
| REQ-002 | 孵化项目能力手册 Skill 模板编写与同步 | [链接](../requirement/SKILL_PROJECT_CAPABILITY_REQ-002_INCUBATION_HANDBOOK.md) | draft |

## 6. 关键影响点

- **后端**：无代码改动。利用现有 skill content 注入机制 + docs/sync 同步机制
- **前端**：无改动
- **数据库**：`agent_skills` 新增 2 条记录（通过 sync 自动创建）
- **API**：无新增接口
- **文档**：新增 `docs/skill/platform-capability-overview.md` 和 `docs/skill/incubation-project-handbook.md`
- **Skill 绑定**：需将新 skill 绑定给对应 Agent（通过 `POST /skills/assign`）

## 7. 风险与依赖

### 约束

- **Skill content 上限 4000 字符**（`SKILL_CONTENT_MAX_INJECT_LENGTH`，env 可覆盖）——能力摘要需控制在此范围内，预估 CTO 总览 ~1500 字符，项目手册 ~1200 字符，均在安全范围内
- **Skill 无 `projectId` 字段**——无法按项目自动区分。通过"不同 skill 绑定给不同 Agent"解决
- **激活条件不支持 `projectId`**——通过 `roleInPlan` 和 `domainType` tag 控制注入时机

### 内容时效性

- 能力摘要是手动维护的——功能模块变更时需同步更新 skill 文档
- 建议：在功能文档维护规范（`docs/feature/RULES.md`）中补充检查项，提醒模块能力变更时同步更新对应 capability skill

### 孵化项目扩展

- 每新增一个孵化项目，需基于 `incubation-project-handbook.md` 模板创建该项目专属的 skill 文档（如 `incubation-project-{slug}-handbook.md`）并绑定给项目负责人 Agent
- 后续可考虑自动化：通过定时任务从 `incubation-projects/:id/stats` 接口拉取数据自动更新 skill content（不在本 plan 范围内）

## 8. 设计细节

### 8.1 Skill 文档结构设计

#### CTO 平台能力总览（`platform-capability-overview.md`）

```yaml
---
name: platform-capability-overview
description: 平台全局功能模块与能力边界总览，供 CTO/全局管理者在规划与决策时使用
category: knowledge
tags:
  - platform
  - capability
  - leadership
  - roleInPlan:planner,planner_initialize,planner_pre_execution:must
status: active
provider: internal
version: '1.0.0'
metadata:
  author: system
  language: zh-CN
  applies_to:
    - platform-planning
    - resource-allocation
    - project-review
---
```

Content 包含：
- 系统定位（一句话）
- 核心模块能力矩阵（每模块 1-2 行，不含技术实现细节）
- 模块间协作关系（Agent → 编排 → 调度 → 会议 的串联）
- 资源边界规则（全局 vs 项目）
- 当前孵化项目清单与状态

#### 孵化项目能力手册（`incubation-project-handbook.md`）

```yaml
---
name: incubation-project-handbook
description: 孵化项目内可用资源与操作能力手册模板，供项目负责人 Agent 在项目规划时使用
category: knowledge
tags:
  - incubation
  - project
  - capability
  - roleInPlan:planner,planner_initialize,planner_pre_execution:must
status: active
provider: internal
version: '1.0.0'
metadata:
  author: system
  language: zh-CN
  applies_to:
    - project-planning
    - resource-management
---
```

Content 包含：
- 项目内可管理的资源类型清单（Agent、计划、调度、需求、会议）
- 每种资源的关键操作与 MCP 工具映射
- 全局资源调用规则（全局 Agent 可被项目使用，项目 Agent 不跨项目）
- 项目模板初始化流程
- 本地项目绑定与 OpenCode 执行路径

### 8.2 激活策略

两个 skill 均使用 `roleInPlan:planner,planner_initialize,planner_pre_execution:must` 作为激活 tag：

- **仅在规划阶段激活**——planner 初始化、规划、预执行阶段
- **执行阶段不激活**——worker/executor 不会被注入能力总览（不需要）
- **普通聊天不激活**——非编排场景下 `roleInPlan` 为空，tag 规则不满足

### 8.3 绑定策略

| Skill | 绑定目标 | 判定条件 |
|-------|---------|---------|
| `platform-capability-overview` | CTO Agent（全局，无 projectId，tier=leadership） | 手动绑定 |
| `incubation-project-{slug}-handbook`（基于模板创建） | 对应孵化项目的负责人 Agent（有 projectId，tier=leadership） | 创建项目时手动绑定 |

### 8.4 内容维护机制

```
docs/skill/platform-capability-overview.md  (编辑)
    ↓  POST /skills/docs/sync
agent_skills (DB 记录更新)
    ↓  Redis 缓存自动失效
下次 skill 激活时注入最新 content
```

更新触发点：
- 新增/下线功能模块 → 更新 `platform-capability-overview.md`
- 新增孵化项目 → 基于模板创建新 skill 文档 + 更新 CTO 总览中的项目清单
- 项目资源变化 → 更新对应项目 handbook skill 文档

## 9. 备注

- 本方案零代码改动，完全利用现有 skill content 注入 + docs/sync + tag 激活机制
- 如果后续发现 4000 字符不够用（比如平台模块持续增长），可通过 env `SKILL_CONTENT_MAX_INJECT_LENGTH` 调大上限
- 后续可扩展 `ActivationField` 支持 `projectId`，实现"同一个 skill 按项目差异化注入 content"，但不在本 plan 范围内
