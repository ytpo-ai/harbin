# Agent 日志页面 Task/Action 两级视图重构

## 背景

当前 Agent 日志页面（`AgentDetail.tsx` Log tab）以扁平列表展示所有 action log，存在以下问题：

1. **信息层级缺失**：所有日志平铺，无法快速了解每次任务执行的整体状况
2. **可读性差**：展示了大量无意义的 ID（runId、sessionId、contextId 等），缺乏业务语义
3. **信息密度低**：每条日志占用大量空间，但关键信息不突出

## 方案设计

### 核心思路

前端纯聚合，不改后端 API。利用现有 `GET /agent-action-logs` 返回数据中的 `details.runId` 字段，按 runId 分组聚合为 Task 维度视图。

### 两级结构

#### 第一级：Task 卡片（折叠态）

- 任务标题（`details.taskTitle` 或 `details.meetingTitle`）
- 整体状态（取最终状态的 action 推断）
- 时间范围（最早到最晚时间戳）
- Action 数量
- 最后一条日志的人性化摘要

#### 第二级：Action 时间线（展开态）

点击 Task 卡片后展开，显示该 Task 下所有 action：

- 用中文语义标签替代原始 action 字符串（如 `runtime:run.started` -> "任务启动"）
- 隐藏所有无意义 ID，只在需要时通过 tooltip 或复制按钮提供
- 关键信息突出：工具名称、执行耗时、错误信息
- 时间线布局，清晰展示执行顺序

### Action 语义映射表

| 原始 action | 中文标签 | 展示重点 |
|---|---|---|
| `runtime:run.started` | 任务启动 | 时间 |
| `runtime:run.step.started` | 步骤开始 | 步骤序号 |
| `runtime:run.completed` | 任务完成 | 耗时 |
| `runtime:run.failed` | 任务失败 | 错误信息 |
| `runtime:run.paused` | 任务暂停 | - |
| `runtime:run.resumed` | 任务恢复 | - |
| `runtime:run.cancelled` | 任务取消 | - |
| `runtime:tool.pending` | 工具等待 | 工具名称 |
| `runtime:tool.running` | 工具执行中 | 工具名称 |
| `runtime:tool.completed` | 工具完成 | 工具名称 + 耗时 |
| `runtime:tool.failed` | 工具失败 | 工具名称 + 错误 |
| `runtime:permission.asked` | 请求授权 | - |
| `runtime:permission.replied` | 授权通过 | - |
| `runtime:permission.denied` | 授权拒绝 | - |
| `task_execution:*` | 编排执行 | 任务类型 |
| `chat_execution:*` | 对话执行 | 会议标题 |
| `chat_tool_call` | 工具调用 | 工具名称 |

## 执行步骤

1. 新增前端分组逻辑 - 将扁平日志按 runId 聚合为 Task 组
2. 重构日志列表为两级结构 - Task 卡片 + Action 时间线
3. Action 展示人性化 - 中文语义标签 + 隐藏 ID + 关键信息突出
4. 精简筛选栏，保留摘要卡片和授权处理
5. 验证构建通过

## 影响范围

- **前端**：仅修改 `frontend/src/pages/AgentDetail.tsx` 中 Log tab 部分
- **后端**：无改动
- **数据模型**：无改动
