# Requirement: AGENT_SKILL_REQ-002_DISCUSSION_CATEGORY_AND_ACTIVATION

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-002 |
| 所属 Feature | AGENT_SKILL |
| 所属 Plan | [AGENT_SKILL_DISCUSSION_MODE_ACTIVATION_PLAN](../plan/AGENT_SKILL_DISCUSSION_MODE_ACTIVATION_PLAN.MD) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | done |
| 创建日期 | 2026-04-28 |
| 最后更新 | 2026-04-28 |

## 2. 需求描述

### 2.1 背景

- Skill 分类缺少“讨论”维度，讨论空间/讨论型交互无法通过 category 快速过滤与管理。
- Agent Runtime 当前场景识别未覆盖 discussion，讨论类 skill 激活依赖弱语义匹配，稳定性不足。

### 2.2 目标

- 新增 Skill 分类：`discussion`。
- 讨论模式（`scenarioMode=discussion`）下优先激活讨论类 Skill。
- 保持 meeting/orchestration/chat 等原有场景行为不回归。

### 2.3 验收条件

- [x] Skills 页面分类下拉包含“讨论（discussion）”，并支持中文别名归一化。
- [x] Runtime `ScenarioType` 与 `CollaborationContext.scenarioMode` 支持 `discussion`。
- [x] discussion 场景可注入 `Working Environment Context (Discussion)` 系统上下文块。
- [x] discussion 模式下，`category=discussion` 的 skill 可被优先激活。
- [x] discussion 模式下，不相关 skill 不应被无条件强制激活。

## 3. 技术方案摘要

- 前端：扩展 `Skills.tsx` 分类常量与 label/alias 映射。
- Contracts：扩展 `ScenarioMode`，新增 `DiscussionCollaborationContext` 结构及 factory 构造。
- Runtime：
  - scenario 解析链路支持 `discussion`。
  - collaboration context builder 增加 discussion 分支。
  - `ContextStrategyService` 增加 discussion 模式激活分支：
    - 优先规则：`skill.category === 'discussion'`
    - 语义信号：`discussion/discuss/thread/debate/brainstorm/讨论`
- 测试：在 `context-strategy.service.spec.ts` 增加 discussion 激活正反例。

### 影响范围

- **前端**：`frontend/src/pages/Skills.tsx`
- **后端 contracts**：`backend/libs/contracts/src/collaboration-context.types.ts`、`backend/libs/contracts/src/collaboration-context.factory.ts`
- **后端 runtime**：
  - `backend/apps/agents/src/modules/agents/context/context-block-builder.interface.ts`
  - `backend/apps/agents/src/modules/agents/context/collaboration-context.builder.ts`
  - `backend/apps/agents/src/modules/agents/context/context-strategy.service.ts`
  - `backend/apps/agents/src/modules/agents/agent-executor.service.ts`
  - `backend/apps/agents/src/modules/agents/agent.types.ts`
- **测试**：`backend/apps/agents/src/modules/agents/context/context-strategy.service.spec.ts`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/AGENT_SKILL_REQ-002_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 兼容历史缓存：`EnabledAgentSkillContext.category` 采用可选字段，不要求一次性清理旧缓存。
