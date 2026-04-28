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
3. 用户可从任意消息创建分叉线程，在线程树中切换上下文
4. 右侧面板可查看知识条目与沉淀文档，并触发手动沉淀

## 2. 需求追溯

| Plan | Requirement | Development | Fix |
|------|------------|-------------|-----|
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-001 核心模型与分叉](../requirement/DISCUSSION_SPACE_REQ-001_CORE_MODEL_AND_BRANCHING.md) | 待补充 | — |
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-002 多角色、知识与沉淀](../requirement/DISCUSSION_SPACE_REQ-002_ROLES_KNOWLEDGE_SEDIMENT.md) | 待补充 | — |
| [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) | [REQ-003 前端页面与联调](../requirement/DISCUSSION_SPACE_REQ-003_FRONTEND_INTEGRATION.md) | 待补充 | — |

## 3. 相关文档

- 规划文档：`docs/plan/DISCUSSION_SPACE_PLAN.md`
- 需求文档：`docs/requirement/DISCUSSION_SPACE_REQ-001_CORE_MODEL_AND_BRANCHING.md`、`docs/requirement/DISCUSSION_SPACE_REQ-002_ROLES_KNOWLEDGE_SEDIMENT.md`、`docs/requirement/DISCUSSION_SPACE_REQ-003_FRONTEND_INTEGRATION.md`
- 技术文档：`docs/technical/`（待补充 Discussion Space 专项设计）

## 4. 相关代码文件

- 后端：`backend/src/modules/discussions/`、`backend/src/shared/schemas/discussion-*.schema.ts`
- 前端：`frontend/src/pages/Discussions.tsx`、`frontend/src/pages/discussions/DiscussionDetail.tsx`、`frontend/src/components/discussion/`
- 前端服务/状态：`frontend/src/services/discussionService.ts`、`frontend/src/stores/discussionStore.ts`
