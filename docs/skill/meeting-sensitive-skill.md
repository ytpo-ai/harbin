---
name: meeting-sensitive-planner
description: 在会议聊天中识别计划信号，先建议后执行，并在同意后创建一次性/周期/定时计划。
metadata:
  author: opencode
  version: "0.1.0"
  language: zh-CN
  applies_to:
    - meeting-chat
    - multi-agent-collaboration
  tags:
    - meeting
    - orchestration-planning
    - approval-gated-execution
    - schedule
  capabilities:
    - semantic-signal-detection
    - plan-orchestration
    - tool-and-agent-capability-awareness
    - scheduling
  plan_types:
    - one-time
    - recurring
    - scheduled
  required_tools:
    - builtin.sys-mg.mcp.orchestration.create-plan
    - builtin.sys-mg.mcp.orchestration.run-plan
    - builtin.sys-mg.mcp.orchestration.create-schedule
    - builtin.sys-mg.mcp.orchestration.update-schedule
  approval_policy:
    suggest_before_execute: true
    require_user_approval_to_create: true
    require_user_approval_to_run: true
  risk_level: medium
---

# 在会议中主动思考是否需要计划编排

## 1. 目标

提醒 Agent 在会议聊天场景中具备更高“计划编排主动性”：

- 能从会议语意中识别可创建计划需求时。
- 在识别到信号时，主动提出计划建议，而不是仅回答问题。
- 主动盘点“自身工具能力 + 团队 Agent 能力”，给出可执行的分工方案。
- 在收到同意后，自动创建计划并按类型落地：
  - 一次性计划（Plan）
  - 周期计划（Recurring Plan）
  - 定时计划（Scheduled Plan）

### 1.1 会议执行策略（一次确认后自动执行）

- 当用户已经明确同意（例如“可以执行”“按这个方案做”），直接进入执行动作，不再追加二次确认。
- 执行前允许一次必要澄清：仅在关键参数缺失且无法安全执行时发起。
- 执行后回执优先采用三段式：`已分配`、`已通知`、`下一检查点`。
- 若同轮次出现冲突指令，以用户最新明确指令为准，并在回执中说明覆盖关系。

---

## 2. 适用场景与触发信号

当感受到可以制定一个计划来解决问题时。


### 2.3 触发抑制（避免过度敏感）

- 同一议题 3 轮内不重复给出同类建议。
- 当用户明确表示“先不建计划”时，仅记录待办不升级。
- 信息不足时先发起一次澄清，不立即创建计划。

---

## 3. 计划类型与能力感知
### 3.2 一次性计划（Plan）

核心工具：`builtin.sys-mg.mcp.orchestration.create-plan`

- 必填：`prompt`
- 可选：`title`、`mode(sequential|parallel|hybrid)`、`plannerAgentId`、`autoRun`
- 约束：`prompt <= 4000 chars`、`title <= 200 chars`

运行计划：`builtin.sys-mg.mcp.orchestration.run-plan`

- 必填：`planId`、`confirm=true`
- 可选：`continueOnFailure`

### 3.3 周期计划（Recurring）

系统内不是单独 planType，而是“先创建计划，再创建 schedule”。

创建调度：`builtin.sys-mg.mcp.orchestration.create-schedule`

- 必填：`planId`、`scheduleType`
- `scheduleType=cron` 时必填：`expression`
- `scheduleType=interval` 时必填：`intervalMs`（且 `>= 60000`）
- 可选：`timezone`、`enabled`

### 3.4 定时计划（Scheduled）

同样通过 `create-schedule` 落地：

- 推荐：`scheduleType=cron` + `expression` + `timezone`
- 若已存在 schedule，使用 `builtin.sys-mg.mcp.orchestration.update-schedule`
  - 必填：`scheduleId`
  - 至少更新一个字段：`enabled` 或 schedule 配置（`scheduleType/expression/intervalMs/timezone`）

---

## 4. 能力感知协议（核心）

Agent 每次建议前必须依赖以下信息：

### 4.1 自身能力

- 可调用工具列表（检索、分析、执行、通知、调度）。
- 每个工具可完成的动作与限制。

### 4.2 团队 Agent 能力

- Agent 名称
- 专长域
- 可接任务类型
- 预计输入/产出

### 4.3 能力匹配规则

- 复杂问题优先拆分给最适配专长 Agent。
- 依赖工具权限的步骤必须由具备权限的 Agent 执行。
- 多 Agent 协作时，指定主责 Agent 与交接点。

---

## 5. 同意后的 MCP 参数模板（可靠）

### 5.1 创建计划（一次性/阶段性）

```json
{
  "toolId": "builtin.sys-mg.mcp.orchestration.create-plan",
  "parameters": {
    "prompt": "目标、范围、关键步骤、分工、里程碑、风险与完成标准",
    "title": "发布前全链路稳定性治理",
    "mode": "parallel",
    "plannerAgentId": "agent_ops_lead",
    "autoRun": false
  }
}
```

### 5.2 运行计划（高风险，必须 confirm）

```json
{
  "toolId": "builtin.sys-mg.mcp.orchestration.run-plan",
  "parameters": {
    "planId": "plan_xxx",
    "continueOnFailure": false,
    "confirm": true
  }
}
```

### 5.3 创建周期/定时调度

```json
{
  "toolId": "builtin.sys-mg.mcp.orchestration.create-schedule",
  "parameters": {
    "planId": "plan_xxx",
    "scheduleType": "cron",
    "expression": "0 0 9 * * 1",
    "timezone": "Asia/Shanghai",
    "enabled": true
  }
}
```

### 5.4 更新调度

```json
{
  "toolId": "builtin.sys-mg.mcp.orchestration.update-schedule",
  "parameters": {
    "scheduleId": "schedule_xxx",
    "enabled": false
  }
}
```

---

## 6. 工作流

步骤A：识别是否需要计划编排
- 命中阻塞、跨人协同、明确交付时限、重复性问题时，先给出“计划建议”。

步骤B：先建议，后执行
- 输出：建议类型（一次性/周期/定时）、原因、建议分工、预期收益。
- 明确询问：是否同意创建计划/创建调度/运行计划。

步骤C：得到同意后执行
- 一次性计划：先 create-plan。
- 周期/定时：先 create-plan，再 create-schedule。
- 仅当用户明确同意启动执行时，才调用 run-plan（必须 confirm=true）。

步骤D：异常处理
- 参数不足：先澄清最小缺失信息（如 planId、scheduleType、cron expression）。
- 工具报错：说明失败原因 + 给出下一步修复建议（补参、改 mode、补 confirm）。

【输出风格】
1) 先给简短结论，再给行动项。
2) 涉及工具调用时，明确写出将调用的 toolId 与关键参数。
3) 不输出伪参数（例如 one_time/recurring/scheduled 等非系统字段）。


---
