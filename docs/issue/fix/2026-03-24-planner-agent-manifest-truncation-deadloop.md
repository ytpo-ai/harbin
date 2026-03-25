# Fix 记录：增量编排 Planner Agent Manifest 截断导致任务分配死循环

## 1. 基本信息

- 标题：Planner Agent Manifest 截断导致无法发现具备 repo-writer/save-prompt-template 的执行者，计划陷入死循环
- 日期：2026-03-24
- 负责人：Van
- 关联需求/会话：Plan `69c181d953a3c074f2eca7f6`（[Test-2] Agency-Agents Prompt 全量导入）
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：计划 `[Test-2] Agency-Agents Prompt 全量导入` 在 drafting 阶段反复失败，经历 3 次 replan，累计生成超过 20 个任务全部失败，最终仍停留在 `drafting` 状态
- 触发条件：计划 Prompt 要求使用 `repo-writer` 和 `save-prompt-template` 工具，但 Planner 在 Agent Manifest 中看不到具备这些工具的 Agent
- 影响范围：所有依赖特定工具且该工具持有者排序靠后的增量编排计划
- 严重程度：高

## 3. 根因分析

### 3.1 直接原因：Agent Manifest 被 2000 字符截断

`planning-context.service.ts:219-220` 中对 Agent Manifest 做了硬截断：

```typescript
const AGENT_MANIFEST_MAX_LENGTH = parseInt(
  process.env.PLANNER_AGENT_MANIFEST_MAX_LENGTH || '2000',   // 默认 2000 字符
);

if (result.length > AGENT_MANIFEST_MAX_LENGTH) {
  return result.slice(0, AGENT_MANIFEST_MAX_LENGTH) + '\n...(已截断)';
}
```

数据库中实际具备 `repo-writer` + `save-prompt-template` 的 Agent：

| Agent | ID | 有 repo-writer | 有 save-prompt-template |
|---|---|---|---|
| Docter-W | `69bc21e4df02210ddbc5707a` | 是 | 是 |
| Coder-T | `69bd2c1af71ae480313d7f35` | 是 | 是 |

但这两个 Agent 在 `agents` 集合中的排序位于 Alex-CEO、Kim-CTO、CEO助理-小武、Kimi-助理、LLM-模型管家之后。前面几个 Agent 的信息（名称、能力、工具列表、简介）已经占满了 2000 字符配额，导致 Docter-W 和 Coder-T **被完全截断**，Planner 根本不知道它们的存在。

### 3.2 深层原因：架构设计缺陷——静态文本注入 vs 工具自查

当前实现将 Agent Manifest 作为**静态文本拼入 Planner Prompt**，通过 system + user message 注入到 Planner Agent 的会话中。这种方式存在根本性缺陷：

1. **截断不可控**：Agent 数量增长时，2000 字符上限必然导致信息丢失
2. **排序偏差**：排在前面的 Agent（通常是高管层）占据配额，真正具备执行工具的低层 Agent 被截断
3. **重复膨胀**：增量规划的每一轮都重新注入完整 Manifest，随轮次增加会话 context 被大量重复文本填满
4. **信息冗余**：Planner Agent 自身已经拥有 `list-agents` 工具（`builtin.sys-mg.internal.agent-master.list-agents`），完全有能力在规划时**自己调用工具查询**完整的 Agent 清单，而不需要系统预先塞入

### 3.3 级联失败链路

```
Agent Manifest 截断（2000 字符）
  → Planner 看不到 Docter-W / Coder-T
  → Planner 将任务分配给无工具的 Agent（CEO助理-小武）
  → 执行者上报 task_inability（"我没有 repo-writer"）
  → 系统触发 redesign / 新任务生成
  → Planner 仍然看不到正确的执行者（Manifest 没变）
  → 反复生成"验证谁有工具"的元任务 / research 取证任务
  → research 任务因输出格式校验失败（缺 proof-fetched-urls 等）
  → 连续失败触发 replan，replan 后 Manifest 仍然截断
  → 3 次 replan 仍无法解决，计划彻底卡死
```

### 3.4 相关模块/文件

| 文件 | 行号 | 说明 |
|---|---|---|
| `backend/src/modules/orchestration/services/planning-context.service.ts` | 47-48, 219-220 | `AGENT_MANIFEST_MAX_LENGTH` 截断逻辑 |
| `backend/src/modules/orchestration/services/planning-context.service.ts` | 110-220 | `buildAgentManifest` 全流程 |
| `backend/src/modules/orchestration/planner.service.ts` | 330-335 | Manifest 注入到 Planner Prompt |
| `backend/src/modules/orchestration/services/incremental-planning.service.ts` | 297-350 | `buildPlannerContext` 组装上下文 |

## 4. 已执行的修复动作

### 4.1 Planner Prompt 增加负向约束（已完成）

在 `planner.service.ts:375` 的执行者选择规则中新增**规则 F**，禁止 Planner 生成"验证执行者工具"的元任务：

```typescript
sections.push('F) **【禁止】生成验证/预检类元任务**：你已拥有完整的 Agent Manifest（含每个 agent 的工具列表和能力标签），必须在规划阶段直接完成执行者匹配决策。严禁将此决策过程外化为执行任务，包括但不限于："核验可用执行者"、"确认谁具备某工具"、"检查 agent 工具可用性"、"验证执行者能力"等。这类任务浪费执行资源且执行者本身无法访问系统 Agent 清单，必定失败。');
```

**注意**：此修复仅缓解了"生成无效元任务"的症状，**未解决 Manifest 截断导致信息丢失的根因**。

## 5. 未修复的根因问题

### 5.1 Agent Manifest 截断问题

**现状**：`AGENT_MANIFEST_MAX_LENGTH` 默认 2000 字符，排序靠后但具备关键工具的 Agent 被截断。

**应修复方向**（二选一）：

**方案 A — Planner 自行调用 list-agents 工具查询**（推荐）

移除 Prompt 中静态注入 Agent Manifest 的逻辑，改为在 Planner Prompt 中要求 Planner 在规划前先调用 `list-agents` 工具获取完整执行者清单。

优点：
- 信息完整，不受字符限制
- 实时性好，反映最新的 Agent 配置
- 减少 Prompt 体积，缓解 context 膨胀

缺点：
- 每轮规划多一次工具调用，增加延迟
- 需要信任 Planner 会遵守指令调用工具

**方案 B — 按工具需求动态过滤 Manifest**

在 `buildAgentManifest` 中，根据计划 Prompt 中提及的工具名（如 `repo-writer`、`save-prompt-template`），优先展示具备这些工具的 Agent，确保关键执行者不被截断。

优点：
- 改动较小，不改变现有交互模式
- 保证关键 Agent 可见

缺点：
- 仍然是静态注入，仍有信息丢失风险
- 需要额外的 Prompt 解析逻辑

### 5.2 增量编排缺乏"工具不可达"的提前终止

当 Planner 在 Manifest 中找不到任何具备所需工具的 Agent 时，应在 reasoning 中明确声明"无可用执行者"并终止规划或请求人工介入，而不是反复尝试分配。当前缺少这个语义层面的熔断机制。

## 6. 排查过程中的误判记录

本次分析过程中走了两个弯路，记录以避免后续重复：

1. **误判一：以为问题是 Planner 不应生成"验证工具"的元任务**。仅看了第一轮 replan 的失败结果（`task_inability`），没有查数据库验证系统中是否真的存在具备工具的 Agent。实际上系统中有 Docter-W 和 Coder-T 两个 Agent 完全具备所需工具，问题在于 Planner 看不到它们。

2. **误判二：以为种子数据中没有分配这两个工具**。只检查了 `backend/scripts/seed/mcp-profile.ts` 的种子文件代码，得出"没有任何 Agent 被分配 repo-writer/save-prompt-template"的错误结论。实际上种子文件只是初始数据，Agent 的工具配置在运行时已通过 UI/API 被修改。**必须查数据库才能确认实际状态**。

   数据库实际情况：
   - `agent_profiles` 中 `technical-architect` 和 `fullstack-engineer` 两个角色已配置了这两个工具
   - `agents` 集合中 Docter-W（`69bc21e4df02210ddbc5707a`）和 Coder-T（`69bd2c1af71ae480313d7f35`）文档的 `tools` 数组中已包含 `builtin.sys-mg.internal.rd-related.repo-writer` 和 `builtin.sys-mg.mcp.prompt-registry.save-template`

## 7. 风险与后续

- 已知风险：当前 Manifest 截断问题未修复，任何依赖排序靠后的 Agent 工具的计划仍可能失败
- 后续优化：
  - 评估并实施方案 A（Planner 自查 list-agents）或方案 B（按需动态过滤 Manifest）
  - 增加"工具不可达"语义熔断
  - 考虑在增量规划的 `buildPlannerContext` 中，将 `agentManifest` 从静态拼接改为工具调用指令
- 是否需要补充功能文档/API文档：需要更新 `docs/guide/PLANER&PROMPT.MD` 和 `docs/guide/EXECUTOR.MD`
