# Meeting Chat Input IME Pause Revoke Plan

## Goal

在会议聊天页面优化发送交互，避免拼音输入时回车误发送；并支持消息在未收到回复前可暂停，暂停后可撤回。

## Scope

- 会议聊天输入区（前端）
- 会议消息发送后的状态与操作区（前端）
- 会议消息暂停/撤回接口与状态约束（后端/API，若现有能力不足）
- 相关功能文档与测试

## Plan

1. 对齐现有会议聊天发送与回复链路，明确“未回复”的判定方式和消息状态机边界。
2. 在输入框中加入 IME 合成态保护：组合输入期间按回车不触发发送，仅在非合成态回车发送。
3. 增加消息发送后“可暂停”交互，并在暂停后暴露“撤回”操作入口与状态展示。
4. 补齐后端消息暂停/撤回能力（或扩展现有接口），并限制为“未回复消息”可操作，保证幂等与并发安全。
5. 联调前后端状态流转（pending -> paused -> revoked），处理竞态场景（回复到达与暂停/撤回并发）。
6. 更新测试与文档，覆盖 IME 回车与暂停撤回主路径。

## Impact

- Frontend: `frontend/src/pages/Meetings.tsx`
- Frontend service: `frontend/src/services/meetingService.ts`
- Backend: `backend/src/modules/meetings/*`（视现状可能涉及 controller/service/schema）
- Docs: `docs/feature/MEETING_CHAT.md`（如有 API/交互变更同步）

## Risks / Dependencies

- 不同浏览器和输入法下 IME 事件触发顺序可能不同，需要兼容性验证。
- 若当前消息模型缺少回复关联字段，需要补充判定逻辑以避免误判“未回复”。
- 暂停/撤回与自动回复存在竞态，需在后端做最终状态裁决与幂等处理。
