# 需求文档管理规范

## 1. 定位

`docs/requirement/` 管理以 **issue/ticket** 粒度拆解的需求单元。每个 requirement 是一个可独立交付、可验收的工作项，对应一次开发（development）和零到多次修复（fix）。

## 2. 层级关系

```
feature (功能模块)
  └── plan (计划方案)           1 feature → N plan
        └── requirement (需求)  1 plan → 1~3 requirement
              ├── development   1 requirement → 1 development
              └── fix           1 requirement → N fix
```

### 2.1 Requirement 拆分判定规则

每个 requirement 对应一次完整的 `develop → review` 周期（= 一组 OpenCode session）。拆分过多会导致 plan 的执行碎片化，因此遵循以下判定标准：

**核心原则：只有"可独立验收"的子交付物才拆为独立 requirement。**

如果 plan 中的多个步骤必须全部完成才能验收任何一个，则不拆，整体作为 1 个 requirement。

#### 判定矩阵

| 情况 | 判定 | 示例 |
|------|------|------|
| plan 的所有步骤是**一条链路**，环环相扣 | 不拆，1 plan → 1 req | "给 Agent 加一个新的运行时 hook"——schema/service/controller/前端一条线 |
| plan 涉及**多个独立模块**，各自可验收 | 拆，1 plan → N req | "消息中心支持飞书+钉钉+邮件三个渠道"——每个渠道独立可验收 |
| plan 有**前置基础 + 上层功能**，基础完成后可独立验证 | 拆为 2 个 req | "新建 MCP profile 数据模型（REQ-1），在此基础上实现治理页面（REQ-2）" |
| plan 步骤多但都服务于**同一个功能点** | 不拆 | "优化编排任务的 SSE 推送"——虽然改了多个文件，但都是同一件事 |

#### 上限约束

- **1 plan 最多拆 3 个 requirement**
- 超过 3 个 → 说明 plan 本身粒度过大，应先拆分为多个 plan
- 通常情况（plan 不复杂）：**1 plan → 1 requirement**

```
plan 拆分决策树：
  └── plan 中是否存在可独立验收的子交付物？
        ├── 否 → 1 plan → 1 requirement
        └── 是 → 独立子交付物有几个？
              ├── ≤ 3 个 → 1 plan → N requirement
              └── > 3 个 → plan 粒度过大，先拆分 plan
```

## 3. 文件命名规范

```
<MODULE>_REQ-<NNN>_<BRIEF>.md
```

- `<MODULE>`：所属功能模块，与 feature 文档名对齐（大写 + 下划线）
- `<NNN>`：三位数字序号，模块内自增
- `<BRIEF>`：需求简述，大写 + 下划线，3-5 个词

### 示例

```
AGENT_SKILL_REQ-001_BATCH_IMPORT.md
AGENT_SKILL_REQ-002_PERMISSION_CHECK.md
ORCHESTRATION_TASK_REQ-001_MANUAL_EDIT.md
```

## 4. 关联约定

### 4.1 上游关联

每个 requirement 文档必须注明：
- **所属 feature**：指向 `docs/feature/<MODULE>.md`
- **所属 plan**：指向 `docs/plan/<PLAN_NAME>.md`
- **需求管理 ID**（可选）：工程智能需求管理系统中的需求 ID，用于文档与系统双向追溯

### 4.2 下游关联

每个 requirement 文档中维护：
- **development 文档**：指向 `docs/development/<MODULE>_REQ-<NNN>_DEVELOPMENT.md`
- **fix 文档列表**：指向 `docs/issue/fix/` 下的修复记录

### 4.3 Session 关联

- **OpenCode Session**（可选）：记录产出该需求的 AI 协作 session 标识，便于回溯讨论上下文

## 5. 文档内容要求

详见 `docs/requirement/TEMPLATE.md`。核心结构：
1. 基本信息（关联 feature/plan/需求管理 ID/session）
2. 需求描述（背景、目标、验收条件）
3. 技术方案摘要（或引用 technical 文档）
4. 交付物与追溯（development + fix 列表）
5. 状态跟踪

## 6. 与其他文档的关系

| 文档类型 | 关系 | 说明 |
|----------|------|------|
| `feature` | 上游 | requirement 是 feature 下某个 plan 的具体拆解 |
| `plan` | 上游 | requirement 从 plan 中派生，plan 中列出所有 requirement |
| `development` | 下游 | 一个 requirement 对应一个 development 记录 |
| `fix` | 下游 | 一个 requirement 可关联多个 fix 记录 |
| `technical` | 引用 | requirement 可引用 technical 文档作为技术方案 |
| `dailylog` | 隔离 | dailylog 不引用 requirement，仅记录工作日志 |

## 7. 状态定义

| 状态 | 含义 |
|------|------|
| `draft` | 需求草稿，尚未开始 |
| `in-progress` | 开发中 |
| `in-review` | 开发完成，待验收 |
| `done` | 已验收交付 |
| `blocked` | 被阻塞，需说明原因 |

## 8. 约束执行检查点

- [ ] 新建 requirement 时，是否已在对应 feature 文档的追溯表中登记？
- [ ] 新建 requirement 时，是否已在对应 plan 文档中关联？
- [ ] development 完成后，是否已更新 requirement 状态？
- [ ] fix 完成后，是否已在 requirement 的 fix 列表中追加？
