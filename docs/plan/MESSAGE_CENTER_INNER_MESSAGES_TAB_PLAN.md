# Message Center Inner Messages Tab Plan

## 1. 需求目标

- 在前端消息中心页面新增“内部消息”Tab。
- 展示 `inner_messages`（Agent 间直发 + 订阅消息）的分页列表。
- 不改变现有“系统消息”未读/已读闭环语义。

## 2. 执行步骤

1. 梳理现有消息中心接口与 `inner_messages` 字段差异，确定统一分页返回结构。
2. 在后端 `message-center` 模块新增内部消息查询接口，按当前登录员工绑定的 Agent ID 过滤。
3. 扩展前端 `messageCenterService`，新增内部消息类型定义与请求方法。
4. 改造 `MessageCenter` 页面为双 Tab：`系统消息` 与 `内部消息`。
5. 在内部消息 Tab 展示模式/事件类型/状态/时间等核心信息，并支持分页与状态筛选。
6. 回归验证系统消息原能力（筛选、已读、全部已读）不受影响。

## 3. 影响点

- 后端：`backend/src/modules/message-center` 查询能力扩展。
- 前端：`frontend/src/services/messageCenterService.ts`、`frontend/src/pages/MessageCenter.tsx`。
- 数据库：读取 `inner_messages`，不改集合结构。

## 4. 风险与约束

- `inner_messages` 无“已读”语义，状态机与系统消息不同，需在 UI 上明确区分。
- 员工未绑定 Agent 时，内部消息列表应返回空集而非报错。
