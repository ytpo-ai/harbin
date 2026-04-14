---
name: rd-plan-requirement-extract
description: 从 plan 文档中提取 requirement 并创建入库 EI 系统，同步到 GitHub Issue。纯需求入库技能，不涉及开发执行流程。
metadata:
  author: opencode
  version: "0.1.0"
  language: zh-CN
  applies_to:
    - plan-requirement-extraction
    - requirement-creation
  tags:
    - rd-plan-requirement-extract
    - domainType:development:must
    - phase:initialize,easy_run:must
  capabilities:
    - plan-document-parsing
    - requirement-extraction-and-creation
    - github-issue-sync
  risk_level: low
---

# RD Plan Requirement Extract 需求提取入库

## 技能定位

本技能**仅负责从 plan 文档中提取 requirement 并入库 EI 系统**，是一个纯数据准备技能。
- 不包含开发执行步骤（exec / review）
- 不包含 requirement 循环机制
- 入库完成后编排即结束（`stop`）

如需在入库后继续执行开发流程，请使用 `rd-plan-workflow` 技能。

## 与其他 skill 的关系

| skill | 职责 |
|-------|------|
| **rd-plan-requirement-extract**（本 skill） | plan 文档 → requirement 入库 + GitHub 同步 |
| rd-plan-workflow | plan 文档 → requirement 入库 + 逐个开发执行（exec→review 循环） |
| rd-workflow | EI 已有 requirement → 单个开发执行（plan→exec→review） |

## 流程原则

- **文档驱动规则（强制）**：plan 文档是本次编排的唯一输入源。plan 文档必须严格遵循 `docs/plan/TEMPLATE.md` 格式，特别是 §5 Requirement 拆解表格。
- **只入库不执行**：本技能完成 requirement 入库和 GitHub 同步后即结束，不产生任何开发任务。

## phaseInitialize 扩展步骤

> 说明：outline 与 phasePrompts 由初始化核心指令统一生成并通过 `plan-initialize(mode=outline)` 写入。
> 本节定义 plan 文档解析与 requirement 入库的扩展步骤。
> 当 phase=`easy_run` 时，直接执行本节“步骤序列”，无需生成 outline。

### 前置条件

- sourcePrompt 中必须包含 plan 文档的仓库相对路径（如 `docs/plan/XXX_PLAN.md`）。
- plan 文档必须包含 `## 5. Requirement 拆解` 段落，且表格至少有 1 行有效 requirement。

### 步骤序列

1. **读取 plan 文档**：调用 `builtin.engineering.internal.fs.repo_read`（参数 `command="cat <plan文档路径>"`），从 sourcePrompt 中提取文档路径。

2. **解析 plan 文档**：从 plan 文档内容中提取以下信息：
   - §1 基本信息：**优先级**（low/medium/high/critical）、**所属项目**（projectId）
   - §2 背景、§3 目标、§4 执行步骤：作为 requirement 的上下文补充
   - §5 Requirement 拆解表格：解析每行的编号（REQ-NNN）、需求简述、状态

3. **逐条创建 requirement 入库**：对每个解析出的 requirement，调用 `builtin.engineering.mcp.requirement.create`，记录返回的 requirementId。

   **字段继承与默认值规则**：

   | requirement 字段 | 值来源 | 默认值 |
   |---|---|---|
   | `title` | §5 表格中的 `REQ-NNN: 需求简述` | 必填 |
   | `description` | §2/§3/§4 中与该 requirement 相关的上下文 + §5 的具体描述 | 必填 |
   | `priority` | **继承 plan 文档 §1 的优先级** | `medium` |
   | `category` | 根据 plan 性质推断：新功能→`feature`，修复→`fix`，优化→`optimize` | `feature` |
   | `complexity` | 根据 §4 执行步骤数和影响范围推断 | `low` |
   | `labels` | 固定包含 `plan:<PLAN_FILE_NAME>` 和 `req:<REQ-NNN>` | 必填 |
   | `projectId` | **继承 plan 文档 §1 的所属项目** | 可选 |
   | `createdByType` | 固定值 | `agent` |

   步骤 3 的 `requirement.create` 参数（每个 requirement 调用一次）：
   ```json
   {
     "title": "<REQ-NNN: 需求简述>",
     "description": "<从 plan 文档 §2/§3/§4 中提取的相关上下文 + 该 requirement 的具体描述>",
     "priority": "<继承 plan §1 优先级，缺省 medium>",
     "category": "<根据 plan 性质推断，缺省 feature>",
     "complexity": "<根据影响范围推断，缺省 low>",
     "labels": ["plan:<PLAN_FILE_NAME>", "req:<REQ-NNN>"],
     "projectId": "<继承 plan §1 所属项目，缺省不传>",
     "createdByType": "agent"
   }
   ```

4. **逐条同步 requirement 到 GitHub Issue**：每个 requirement 入库成功后，立即调用 `builtin.engineering.mcp.requirement.sync-github` 将其同步为 GitHub Issue。

   步骤 4 的 `requirement.sync-github` 参数（每个 requirement 调用一次）：
   ```json
   {
     "requirementId": "<入库返回的ID>"
   }
   ```
   > 说明：`owner` 和 `repo` 参数可省略，由系统从项目配置中自动获取。如需指定可显式传入。

5. **输出入库结果摘要**：汇总所有入库成功的 requirement 信息，作为本次编排的最终输出。

   输出格式：
   ```
   Plan 文档: <plan文档路径>
   入库 requirement 数量: <N>
   
   | # | REQ 编号 | 标题 | requirementId | GitHub Issue | 状态 |
   |---|----------|------|---------------|-------------|------|
   | 1 | REQ-001  | ...  | req-xxx       | #123        | todo |
   | 2 | REQ-002  | ...  | req-yyy       | #124        | todo |
   ```

## Outline 生成规则

> 仅适用于标准 initialize 流程；easy_run 模式忽略本节。

本技能**不生成任何执行步骤**。phaseInitialize Phase 1 生成 outline 时，传入**空数组**：

```json
[]
```

> 所有工作在 phaseInitialize Phase 2（skill 扩展步骤）中完成。Phase 2 完成后编排自动结束。

## 需求状态更新规则

| 时机 | 状态 | 触发方 | 工具 |
|------|------|--------|------|
| 入库 | `todo` | requirement.create 默认 | `requirement.create` |
| 同步 GitHub | - | Planner 工具调用 | `requirement.sync-github` |

> 本技能不涉及 assigned / in_progress / review / done 等后续状态变更。需求入库后状态为 `todo`，等待后续编排（rd-workflow 或 rd-plan-workflow）或人工分配。
