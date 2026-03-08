# 会议管理 MCP 工具开发计划

## 概述

为 Agent 添加会议管理的 MCP 工具，支持在会议上下文中查询会议列表、发送消息、修改会议状态。

## 功能需求

1. **查询当前会议列表** - 获取所有进行中的会议
2. **向会议发送消息** - 在指定会议中发送消息
3. **修改会议状态** - 启动、结束、暂停、恢复会议

## 执行步骤

### 1. 添加 MCP 工具定义

在 `backend/apps/agents/src/modules/tools/tool.service.ts` 中添加 3 个工具定义：

- `builtin.mcp.meeting.list` - 查询当前会议列表
- `builtin.mcp.meeting.sendMessage` - 向会议发送消息  
- `builtin.mcp.meeting.updateStatus` - 修改会议状态

### 2. 实现工具执行逻辑

- 在 `executeToolImplementation` 方法中添加 case 处理
- 在 `getImplementedToolIds` 方法中注册工具 ID

### 3. 实现 Meeting MCP 业务方法

在 ToolService 中添加私有方法：

- `listMeetings(params)` - 调用 GET /meetings API
- `sendMeetingMessage(params, agentId)` - 调用 POST /meetings/:id/messages API
- `updateMeetingStatus(params, agentId)` - 调用 start/end/pause/resume API

### 4. 注册 MeetingService 依赖

- 在 ToolService 构造函数中注入 BackendApiService（用于调用后端 API）

## 关键影响点

- **后端**: 需通过 HTTP 调用 backend 的 meeting API
- **API 端点**:
  - GET /api/meetings - 获取会议列表
  - POST /api/meetings/:id/messages - 发送消息
  - POST /api/meetings/:id/start|end|pause|resume - 状态管理
- **权限**: 添加 basic 级别权限检查

## 工具参数设计

### meeting.list

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 否 | 筛选状态 (pending/active/paused/ended) |
| limit | number | 否 | 返回数量限制 |

### meeting.sendMessage

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| meetingId | string | 是 | 会议 ID |
| content | string | 是 | 消息内容 |
| type | string | 否 | 消息类型 |

### meeting.updateStatus

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| meetingId | string | 是 | 会议 ID |
| action | string | 是 | 操作 (start/end/pause/resume) |

## 状态

- [ ] 待开发
- [ ] 开发中
- [ ] 待测试
- [ ] 完成
