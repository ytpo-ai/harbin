# AgentSession 页面仅展示 assistant 消息修复记录

## 1. 基本信息

- 标题：AgentSession 页面 system/user 消息缺失
- 日期：2026-03-22
- 负责人：OpenCode
- 关联需求/会话：用户反馈“agentsession 页面仅展示助理信息，不展示系统信息和用户信息”
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：`frontend/src/pages/AgentDetail.tsx` 的 Session 消息轨迹中，常见仅显示 `assistant`，缺失 `system` 与 `user`。
- 触发条件：Runtime 改造后，Session 详情主要依赖 `agent_sessions.messageIds`；历史 run 中部分 `user/system` 未被该引用列表覆盖。
- 影响范围：Agent 详情页 Session 抽屉的消息完整性与排障可观测性。
- 严重程度：中

## 3. 根因分析

- 直接原因：`getSessionDetailById` 仅按 `session.messageIds` 回查消息，未补齐 run 级消息与 run metadata 的 system 快照。
- 深层原因：会话存储从 `messages[]` 迁移为 `messageIds[]` 引用后，查询侧缺少“兼容补全层”，导致前端读取维度收窄。
- 相关模块/文件：
  - `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
  - `frontend/src/pages/AgentDetail.tsx`

## 4. 修复动作

- 修复方案：在 Session 详情查询阶段做消息补全，不改变运行时持久化策略。
- 代码改动点：
  - `getSessionDetailById` 增加 run 级补全逻辑：
    - 先按 `messageIds` 取主消息集合；
    - 再按 `runIds` 回查缺失的 `user/system` 消息并合并去重；
    - 从 `run.metadata.initialSystemMessages` 生成虚拟 `system` 消息注入返回；
    - parts 查询改为覆盖合并后的真实 messageId 集合。
- 兼容性处理：
  - 保持 DB 结构不变，不回写虚拟消息；
  - 仅影响查询返回，兼容旧会话与新会话。

## 5. 验证结果

- 验证步骤：
  - 静态检查 `runtime-persistence.service.ts` 变更，确认补全来源与去重逻辑生效。
  - 执行 `npx eslint "apps/agents/src/modules/runtime/runtime-persistence.service.ts"`。
  - 执行 `npx tsc -p tsconfig.json --noEmit`（在 `backend/`）。
- 验证结论：部分通过
- 测试与检查：
  - eslint 通过；
  - 全量 tsc 未通过，报错位于既有文件 `apps/agents/src/modules/skills/skill.controller.ts:110`（与本次修复无关）。

## 6. 风险与后续

- 已知风险：
  - 虚拟 system 消息不带 messageId 对应的 parts，前端会展示正文但无 parts 展开。
- 后续优化：
  - 可在 API 响应中显式标记 `virtual: true`，前端可更清晰区分“持久化消息”与“运行快照消息”。
- 是否需要补充功能文档/API文档：是（已更新功能与 guide 文档）
