---
name: agent-team-architecture-skill
description: Runtime behavior rules for three-tier role governance across leadership, operations, and temporary workers for both agents and human staff.
metadata:
  author: opencode
  version: "1.0.0"
  language: zh-CN
  applies_to:
    - role-governance
    - orchestration
    - task-delegation
  capabilities:
    - tier-classification
    - delegation-guard
    - command-priority-resolution
    - temporary-worker-restriction
  risk_level: medium
---

# Agent 团队架构 Skill

用于在运行时执行三层角色协议，确保任务分配、能力使用与指挥优先级符合治理约束。

## 1) 分层识别规则

在任何分派或编排前，先识别角色层级：

- `高管`：CTO、CEO、人类高管专属助理
- `临时工`：临时工 Agent
- `执行层`：除高管与临时工外的全部角色

若无法识别层级：

- 拒绝进入分派流程
- 返回 `tier_resolution_required`

## 2) 默认能力规则

### 2.1 高管默认能力

高管默认可使用：

- 会议创建能力
- 计划编排全部能力
- 网络检索能力
- 可按任务类型自由选择自身执行模型

高管模型选择执行约束：

- 仅高管级别 Agent 可触发该自由选择能力
- 选择发生在任务执行阶段，不影响角色分层判定
- 不得突破平台安全与合规限制

### 2.2 临时工能力限制

临时工默认：

- 不具备任何系统管理工具
- 仅可执行被分配的子任务
- 不可发起全局计划编排

### 2.3 执行层能力范围

- 可执行被分配任务
- 可在允许链路中向临时工继续分派子任务
- 不自动具备高管治理权限

## 3) 任务分派策略

### 3.1 允许的分派方向

- 高管 -> 执行层
- 高管 -> 临时工
- 执行层 -> 临时工

### 3.2 禁止的分派方向

- 临时工 -> 高管
- 临时工 -> 执行层

若命中禁止方向：

- 阻断分派
- 返回 `delegation_direction_forbidden`

## 4) 高管优先级与仲裁

### 4.1 专属助理优先级

人类高管专属助理具有增强话语权：

- 在授权场景下，其指令优先于其他普通 Agent 的同级建议
- 其他高管在指定场景中必须遵循该指令

### 4.2 授权场景判定

仅当满足以下条件之一时，触发“必须遵循”：

- 指令被标记为人类高管直接授权
- 指令涉及优先级重排、计划冻结、资源再分配

且必须满足：

- 指令不违反平台安全与合规约束

### 4.3 冲突处理顺序

按以下顺序解析冲突：

1. 安全与合规约束
2. 人类高管专属助理授权指令
3. 既定计划规则
4. 其他高管协商结果

## 5) 运行时检查清单

- [ ] 已完成角色层级识别
- [ ] 已应用对应层级默认能力与限制
- [ ] 高管模型选择行为已按任务类型生效（仅高管 Agent）
- [ ] 分派方向合法
- [ ] 临时工未获得系统管理工具
- [ ] 指挥冲突已按优先级处理

## 6) 拒绝条件

- `tier_resolution_required`
  - 无法确定角色属于高管/执行层/临时工
- `delegation_direction_forbidden`
  - 分派方向不在允许列表
- `temporary_worker_tool_violation`
  - 临时工被授予系统管理工具
- `executive_instruction_auth_missing`
  - 专属助理指令缺少授权标记却要求高优先执行

## 7) 推荐输出结构

```json
{
  "result": "ok",
  "checkedAt": "<timestamp>",
  "tierResolution": {
    "sourceRole": "<role>",
    "sourceTier": "leadership|operations|temporary",
    "targetRole": "<role>",
    "targetTier": "leadership|operations|temporary"
  },
  "delegation": {
    "allowed": true,
    "reason": "allowed_direction"
  },
  "capabilityGuards": {
    "executiveDefaultsApplied": true,
    "temporaryWorkerHasNoSystemTools": true
  },
  "priorityResolution": {
    "humanExclusiveAssistantPriority": "applied|not_applied",
    "authMarker": "present|absent"
  }
}
```

## 8) 关联文档

- `docs/architecture/AGENT_ROLE_TIER_ARCHITECTURE.md`
- `docs/plan/AGENT_ROLE_TIER_PROTOCOL_PLAN.md`
