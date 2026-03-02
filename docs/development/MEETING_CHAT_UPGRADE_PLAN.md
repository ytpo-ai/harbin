# 会议/聊天升级优化开发总结

> 状态：已并入统一主总结 `docs/development/MEETING_CAPABILITY_MASTER_PLAN.md`，本文件保留历史细节。

## 背景与目标

本次开发围绕会议/聊天体验进行了连续迭代，目标包括：

1. 支持单会议独立页面打开。
2. 支持聊天输入 `@成员` 提示。
3. 增加右侧会议操作区（改名、成员管理）。
4. 优化会议操作按钮与状态切换体验。
5. 修复会话跳转与切换稳定性问题。

## 主要交付

### 1) 单会议独立页面能力

- 新增路由：`/meetings/:meetingId`。
- 保留 `/meetings` 作为主会议页（左侧列表 + 右侧详情）。
- 单开页不显示全局菜单和会议列表，聚焦会议聊天。
- 聊天头部增加“新开 tab”按钮，显式打开当前会议独立页。

### 2) 聊天输入 `@成员` 提示

- 输入框识别 `@` 触发 mention 候选。
- 支持键盘上下选择、Enter/Tab 确认、Esc 关闭。
- 支持中文输入法（composition）场景，避免误触发。

### 3) 右侧会议操作区

- 新增会议名称编辑与保存。
- 新增参会人员管理：
  - 查看当前参会人
  - 添加成员/Agent
  - 移除成员（主持人不可移除）
- 操作区支持折叠/展开；单开页默认收起。

### 4) 会议操作体验优化

- 聊天头部“暂停/结束/归档/删除”统一支持图标按钮样式。
- 删除能力支持未开始会议（pending）。
- 结束会议后头部状态即时刷新，动作按钮即时更新。

### 5) 1 对 1 会议扩展改名

- 当 1 对 1 会议新增非隐形 Agent 后，自动将标题切换为多人讨论语义。
- 保留系统内置隐形 Agent（Model Management Agent）判定逻辑，避免误改名。
- 改名后通过 `settings_changed` 事件下发，前端即时同步显示。

### 6) Agent 列表“开始聊天”链路

- Agent 卡片点击“开始聊天”后：
  - 优先复用已有 1 对 1 会话
  - 无会话时自动创建
  - 跳转会议页并自动打开目标会话

## 关键修复记录

1. 修复“开始聊天后首次进入会议页不自动打开目标会话（需刷新）”问题。
2. 修复“会议列表点击其他会话时右侧内容不切换（卡住）”问题。
3. 修复“结束会议后头部状态不更新，删除按钮不出现”问题。
4. 修复“1 对 1 邀请新 Agent 后标题未改名”规则误判问题。

## 后端接口补充

- `PUT /meetings/:id/title`：修改会议名称。
- `POST /meetings/:id/participants`：添加参会人员。
- `DELETE /meetings/:id/participants/:participantType/:participantId`：移除参会人员。
- `DELETE /meetings/:id`：删除会议（支持 pending / ended / archived）。

## 涉及主要文件

- `frontend/src/App.tsx`
- `frontend/src/pages/Meetings.tsx`
- `frontend/src/pages/Agents.tsx`
- `frontend/src/services/meetingService.ts`
- `backend/src/modules/meetings/meeting.controller.ts`
- `backend/src/modules/meetings/meeting.service.ts`
- `README.md`
- `docs/api/API.md`
- `docs/plan/MEETING_CHAT_UPGRADE_PLAN.md`

## 验证结果

- 前端构建：`npm run build` 通过。
- 后端构建：`npm run build` 通过。

## 备注

本次为同一 session 的持续迭代开发，需求在执行中有多次语义修正（例如“单开页面”的定义、单开页是否展示操作区、按钮图标化等），均已在计划文档与本总结中同步沉淀。
