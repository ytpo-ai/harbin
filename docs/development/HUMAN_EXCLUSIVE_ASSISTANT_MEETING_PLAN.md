# 人类专属助理会议能力开发总结

## 背景

本次开发围绕“人类专属助理”机制展开，目标是让人类员工/高管在会议场景中通过其专属助理完成主持与发言，并在系统层面强制执行绑定前置条件。

## 最终业务规则

1. 人类员工/高管必须绑定专属助理，否则不可发起或参与会议。
2. 人类登录后若未绑定专属助理，系统弹出阻断引导，支持一键“创建并绑定专属助理”。
3. 人类发起会议时，会议主持人自动切换为其专属助理（host 为 agent）。
4. 人类本人不加入会议参与者列表。
5. 人类在会中发送消息时，后端自动映射为其专属助理身份发言。
6. 专属助理不主动响应，仅在其对应人类显式 `@` 时响应。

## 关键实现

### 1) 员工与专属助理绑定能力

- 新增员工字段：`exclusiveAssistantAgentId`，并与历史 `aiProxyAgentId` 兼容联动。
- 新增接口：
  - `POST /employees/:id/exclusive-assistant`（绑定）
  - `GET /employees/:id/exclusive-assistant`（查询）
  - `POST /employees/:id/exclusive-assistant/auto-create`（一键创建并绑定）
- 新增唯一性校验：同一个助理 Agent 不能同时绑定多个不同人类账号。

涉及文件：
- `backend/src/shared/schemas/employee.schema.ts`
- `backend/src/modules/employees/employee.service.ts`
- `backend/src/modules/employees/employee.controller.ts`

### 2) 登录后阻断引导

- 在全局布局中加载当前用户对应员工信息。
- 若当前用户为人类且未绑定专属助理，展示阻断弹层。
- 点击“创建专属助理”后调用 auto-create 接口，成功后自动解除阻断。

涉及文件：
- `frontend/src/components/Layout.tsx`
- `frontend/src/services/employeeService.ts`

### 3) 会议主持人与参与者逻辑

- 创建会议时，若请求 host 为人类，后端自动重写 host 为其专属助理（`hostType=agent`）。
- 不再把人类发起者自动加入 `participants`。
- 会议 participant 扩展了专属助理身份字段：
  - `isExclusiveAssistant`
  - `assistantForEmployeeId`

涉及文件：
- `backend/src/modules/meetings/meeting.service.ts`
- `backend/src/shared/schemas/meeting.schema.ts`

### 4) 人类发言自动代理为助理发言

- `POST /meetings/:id/messages` 当 `senderType=employee` 时：
  - 先解析该员工专属助理
  - 自动改写消息 `senderId/senderType` 为助理
  - 写入代理标记 metadata：`isAIProxy=true`、`proxyForEmployeeId`
- 保留“由人类触发会后续响应”的语义，避免因 sender 改写导致自动响应链路失效。

涉及文件：
- `backend/src/modules/meetings/meeting.service.ts`

### 5) 前端会议页体验调整

- 创建会议弹窗不再允许手动选择主持人，改为提示“将由专属助理主持”。
- 人类消息输入区域提示“将以专属助理身份发言”。
- 当前用户专属助理发出的消息按用户侧样式展示。
- 专属助理名称在参与者展示与 @ 提示中按“某某的专属助理”显示。

涉及文件：
- `frontend/src/pages/Meetings.tsx`
- `frontend/src/services/meetingService.ts`

## 文档更新

- `README.md`
- `docs/api/API.md`
- `docs/plan/HUMAN_EXCLUSIVE_ASSISTANT_MEETING_PLAN.md`

## 验证结果

已完成构建验证：

- backend: `npm run build` 通过
- frontend: `npm run build` 通过

## 后续建议

1. 补充自动化测试：会议创建 host 重写、消息代理发送、专属助理 @ 触发边界。
2. 增加幂等保障与审计日志：auto-create 接口防重复创建、记录创建来源与操作者。
3. 对历史数据增加巡检脚本：识别并修复“人类无助理绑定但仍在活跃会议”的存量数据。
