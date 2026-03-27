# RD Requirement development 需求开发流程

## 流程原则

- **先采集事实，再做判断**——任何输出前必须先调用工具读取相关文档或代码。
- **数据锚定规则（强制）**：step0 选定的 requirementId 是本次编排的唯一锚点。后续所有 step 的 task.description 必须在开头显式引用该 requirementId 和标题原文，禁止替换为其他需求。
- **需求状态更新（强制）**：任务执行完成必须通过工具调用更新 requirement 状态。

## 执行引擎约束（Planner 必须遵守）

以下 step 需要在 opencode 代码工程环境中执行，Planner 生成任务时必须遵守：
1. step2（技术方案）、step3（执行开发）的 taskType 必须设为 `development`
2. step4（实现评估）的 taskType 必须设为 `review`
3. 所有 step 的 task.description 中，禁止出现以下内部工具引用关键词：
   `repo-writer`、`repo-read`、`builtin.sys-mg`、`save-template`、`save-prompt-template`
   如需描述代码操作，使用"读取代码"、"修改代码"、"提交变更"等自然语言表述
4. Planner 在分配（生成）任务前必须使用工具修改需求状态

## 步骤定义（严格按序执行）

### step0: 选定最高优先级需求
- **执行角色**: Kim-CTO（从 list-agents 中查找 role 包含 executive-lead 的 agent）
- **输入**: 当前 EI 需求池
- **动作**: 调用 requirement.board 或 requirement.list 获取需求列表；选择优先级最高且状态为 todo/open 的可执行需求；然后调用 requirement.detail 获取该需求的完整描述
- **输出契约（必须包含，缺一不可）**:
  1. requirementId（需求唯一标识）
  2. 标题原文
  3. **需求描述原文（description 字段的完整内容，禁止省略或改写）**
  4. 选择依据（1-2 条）
- **下游绑定**: 后续所有 step 在 task.description 开头必须注明 `【锚定需求】requirementId=<step0输出的ID>, 标题=<step0输出的标题>`

### step1: 确认需求范围
- **执行角色**: 与 step0 同一 agent（Kim-CTO）
- **输入**: step0 输出的 requirementId + 标题 + **需求描述原文**
- **动作**: 以需求描述原文为唯一事实来源，直接复述需求描述原文
- **输出契约**: 必须包含需求描述原文
- **约束**: 禁止改变 requirementId；禁止将需求替换为其他条目

### step2: 制定技术开发计划
- **执行角色**: 技术专家（从 list-agents 中查找能力标签包含"development_plan"及"opencode"的 agent）
- **输入**: 读取需求详情和相关代码/文档；明确业务边界、验收标准、最小变更范围
- **动作**: 基于需求规格设计实现方案，拆解开发子任务，评估技术风险
- **输出契约**: 结构化开发计划（含实现步骤、涉及文件/接口清单、测试要点）
- **约束**: taskType 设为 development；输出中避免引用具体内部工具名称

### step3: 执行开发
- **执行角色**: 全栈开发（选择当前状态空闲的 "development_exec"及"opencode" agent）
- **输入**: step2 输出的开发计划
- **动作**: 按计划实施代码变更并提交
- **输出契约**: 代码 commit 信息（含 commit hash、变更文件列表、变更摘要）
- **约束**: taskType 设为 development；描述中使用"读取代码"、"修改代码"、"提交变更"等自然语言，禁止引用内部工具名称

### step4: 实现评估
- **执行角色**: 技术专家（与 step2 同一 agent）
- **输入**: step3 输出的 commit 信息 + step2 的开发计划及验收清单
- **动作**: 对照验收标准评估实现质量，给出通过/修改意见
- **输出契约**: 评估结论（通过/需修改 + 具体意见）
- **约束**: taskType 设为 review

## 需求上下文获取规则（强制）

以下规则用于 Orchestration 规划阶段，约束 planner agent 必须先通过 Requirement MCP 获取最新需求详情，再进行任务拆解：

```text
需求上下文获取规则（强制）:
- requirementId: ${info.requirementId}
- 在开始拆解任务前，必须先调用工具 `builtin.sys-mg.mcp.requirement.get` 获取最新需求详情。
- 调用参数必须包含 requirementId，禁止凭记忆或历史快照推断需求状态。
- 获取后请在你的规划中以内嵌摘要方式体现标题、状态、优先级、标签和核心描述。
- 若工具不可用或调用失败，请直接输出 `TASK_INABILITY: requirement.get failed` 并停止规划。
- 需求摘要最大长度建议 ${REQUIREMENT_DETAIL_MAX_LENGTH} 字符。
```

## 需求状态更新规则（强制）

以下规则用于 Orchestration 运行阶段，约束 planner/CTO agent 必须通过工具完成 requirement 状态回写：

```text
需求状态更新规则（强制）:
- Planner必须通过工具builtin.sys-mg.mcp.requirement.update-status调用完成需求状态回写，不允许只输出文本结论。
- 每个步骤完成前都必须立即执行一次状态更新。
- 状态更新时机：
  1. step0 任务生成后，状态更新为 `assigned`（Assigned，需求分配给 Agent）。
  2. step0/step1/step2 生成后，状态更新为 `in_progress`（In Progress）。
  3. step4 生成后，状态更新为 `review`（Review）。
- 工具ID: builtin.sys-mg.mcp.requirement.update-status
- 调用参数必须包含：
  - requirementId: <当前需求ID>
  - status: <todo|assigned|in_progress|review|done|blocked>
  - changedByType: agent
  - changedByName: orchestration-planner-agent
  - note: `Kim-CTO 执行  <任务标题>`
- 执行工具后必须输出证明块（单独一行）：
  REQUIREMENT_STATUS_UPDATE_PROOF: {"toolId":"builtin.sys-mg.mcp.requirement.update-status","requirementId":"<当前需求ID>","status":"<目标状态>"}
- 若工具不可用或调用失败，必须输出：TASK_INABILITY: <reason>
```
