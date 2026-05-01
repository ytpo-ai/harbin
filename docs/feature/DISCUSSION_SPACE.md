# Discussion Space（讨论空间）

## 1. 功能设计

### 1.1 目标

- 提供树状可分叉讨论能力，替代线性一问一答对话
- 支持多角色（真人 + AI）协作与 @ 唤醒分发
- 支持讨论知识沉淀与文档沉淀（manual / realtime）

### 1.2 数据结构

- `discussion_spaces`：空间主表（主题、状态、设置、统计、沉淀历史）
- `discussion_threads`：讨论线树结构（parent/child、深度、摘要）
- `discussion_messages`：消息明细（mentions、branchSuggestions、crossReferences）
- `discussion_participants`：参与者（human / ai_agent、presence、角色）
- `discussion_knowledge_entries`：知识条目（来源、标签、可信度）

### 1.3 核心链路

1. 创建讨论空间后自动生成根线程与创建者参与者
2. 在指定线程发送消息，后端完成 mention 分发、知识沉淀和统计更新
   - 对 AI mention 目标，回复由 Agent runtime 执行链路生成（带 run/session 可追溯信息）
3. 用户可从任意消息创建分叉线程，系统会在新线程首条写入分叉来源消息（`branch_context`），在线程树中切换上下文
4. 右侧面板可查看知识条目与沉淀文档，并触发手动沉淀（任务化 + SSE 状态流 + 标题驱动）

## 2. 需求追溯

| Plan | Requirement | Development | Fix |
|------|------------|-------------|-----|
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-001 核心模型与分叉](../requirement/DISCUSSION_SPACE_REQ-001_CORE_MODEL_AND_BRANCHING.md) | 待补充 | — |
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-002 多角色、知识与沉淀](../requirement/DISCUSSION_SPACE_REQ-002_ROLES_KNOWLEDGE_SEDIMENT.md) | 待补充 | — |
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-003 前端页面与联调](../requirement/DISCUSSION_SPACE_REQ-003_FRONTEND_INTEGRATION.md) | 待补充 | — |
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-004 输入效率优化（复制/默认回复 Agent）](../requirement/DISCUSSION_SPACE_REQ-004_REPLY_EFFICIENCY_OPTIMIZATION.md) | 待补充 | — |
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-005 布局优化与沉淀历史可见性增强](../requirement/DISCUSSION_SPACE_REQ-005_LAYOUT_AND_SEDIMENT_HISTORY.md) | 待补充 | — |
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-006 沉淀历史删除能力](../requirement/DISCUSSION_SPACE_REQ-006_SEDIMENT_HISTORY_DELETE.md) | 待补充 | — |
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-007 讨论线删除能力](../requirement/DISCUSSION_SPACE_REQ-007_THREAD_DELETE_CAPABILITY.md) | 待补充 | — |
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-008 消息级知识落档能力](../requirement/DISCUSSION_SPACE_REQ-008_MESSAGE_KNOWLEDGE_ARCHIVE_ACTION.md) | 待补充 | — |
| [INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) | [REQ-009 讨论空间分类](../requirement/DISCUSSION_SPACE_REQ-009_SPACE_CATEGORY.md) | 待创建 | — |
| [INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) | [REQ-010 文档大纲升级与 Agent 自动生成](../requirement/DISCUSSION_SPACE_REQ-010_DOCUMENT_OUTLINE_UPGRADE.md) | 待创建 | — |
| [INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) | [REQ-011 知识库增强与沉淀大纲驱动改造](../requirement/DISCUSSION_SPACE_REQ-011_KNOWLEDGE_OUTLINE_DRIVEN.md) | 待创建 | — |
| [INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) | [REQ-012 孵化项目与讨论空间聚合打通](../requirement/DISCUSSION_SPACE_REQ-012_INCUBATION_DISCUSSION_LINK.md) | [开发记录](../development/DISCUSSION_SPACE_REQ-012_DEVELOPMENT.md) | — |
| [INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) | [REQ-013 讨论消息转为需求](../requirement/DISCUSSION_SPACE_REQ-013_DISCUSSION_TO_REQUIREMENT.md) | 待创建 | — |
| [INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) | [REQ-015 数据讨论闭环协作](../requirement/DISCUSSION_SPACE_REQ-015_DATA_DISCUSSION_CLOSED_LOOP.md) | 待创建 | — |
| [DISCUSSION_SPACE_ARCHIVE_CAPABILITY_PLAN](../plan/DISCUSSION_SPACE_ARCHIVE_CAPABILITY_PLAN.md) | [REQ-016 讨论空间归档能力](../requirement/DISCUSSION_SPACE_REQ-016_SPACE_ARCHIVE_CAPABILITY.md) | 待创建 | — |

## 3. 相关文档

- 规划文档：`docs/plan/DISCUSSION_SPACE_PLAN.md`、`docs/plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md`、`docs/plan/DISCUSSION_SPACE_ARCHIVE_CAPABILITY_PLAN.md`
- 需求文档：`docs/requirement/DISCUSSION_SPACE_REQ-001_CORE_MODEL_AND_BRANCHING.md`、`docs/requirement/DISCUSSION_SPACE_REQ-002_ROLES_KNOWLEDGE_SEDIMENT.md`、`docs/requirement/DISCUSSION_SPACE_REQ-003_FRONTEND_INTEGRATION.md`、`docs/requirement/DISCUSSION_SPACE_REQ-004_REPLY_EFFICIENCY_OPTIMIZATION.md`、`docs/requirement/DISCUSSION_SPACE_REQ-005_LAYOUT_AND_SEDIMENT_HISTORY.md`、`docs/requirement/DISCUSSION_SPACE_REQ-006_SEDIMENT_HISTORY_DELETE.md`、`docs/requirement/DISCUSSION_SPACE_REQ-007_THREAD_DELETE_CAPABILITY.md`、`docs/requirement/DISCUSSION_SPACE_REQ-008_MESSAGE_KNOWLEDGE_ARCHIVE_ACTION.md`、`docs/requirement/DISCUSSION_SPACE_REQ-009_SPACE_CATEGORY.md`、`docs/requirement/DISCUSSION_SPACE_REQ-010_DOCUMENT_OUTLINE_UPGRADE.md`、`docs/requirement/DISCUSSION_SPACE_REQ-011_KNOWLEDGE_OUTLINE_DRIVEN.md`、`docs/requirement/DISCUSSION_SPACE_REQ-012_INCUBATION_DISCUSSION_LINK.md`、`docs/requirement/DISCUSSION_SPACE_REQ-013_DISCUSSION_TO_REQUIREMENT.md`、`docs/requirement/DISCUSSION_SPACE_REQ-015_DATA_DISCUSSION_CLOSED_LOOP.md`、`docs/requirement/DISCUSSION_SPACE_REQ-016_SPACE_ARCHIVE_CAPABILITY.md`
- 技术文档：`docs/technical/`（待补充 Discussion Space 专项设计）

## 4. 相关代码文件

- 后端：`backend/src/modules/discussions/`、`backend/src/shared/schemas/discussion-*.schema.ts`
- 前端：`frontend/src/pages/Discussions.tsx`、`frontend/src/pages/discussions/DiscussionDetail.tsx`、`frontend/src/components/discussion/`
- 前端服务/状态：`frontend/src/services/discussionService.ts`、`frontend/src/stores/discussionStore.ts`
