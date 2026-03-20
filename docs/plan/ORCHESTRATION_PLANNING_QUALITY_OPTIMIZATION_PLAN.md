# 编排计划质量优化方案

## 需求背景

当前编排系统的计划拆解（planning）环节表现不理想：
- Planner agent 产出的任务描述空泛，缺乏具体文件路径、接口、字段信息
- Skill 方法论（如 `cto-rd-workflow`）定义的约束被 planner 忽略
- 任务无法被执行 agent 直接理解和落地

## 根因分析

| 层级 | 问题 | 根因位置 | 影响 |
|------|------|----------|------|
| L1: Planner 上下文缺失 | planner 只收到 sourcePrompt + mode | `planner.service.ts:227-232` | 任务必然抽象 |
| L2: Skill 约束未绑定 | skill 作为"背景知识"注入，planner 可忽略 | `agent-executor.service.ts:1381-1438` | 方法论被复述而非遵守 |
| L3: 无 Context Pipeline | planning 前无上下文采集阶段 | `orchestration.service.ts:210-232` | planner 只能猜测 |
| L4: 输出验证缺失 | 只验证 JSON 结构，不验证内容质量 | `planner.service.ts:101-115` | 低质量计划进入执行 |
| L5: 后处理硬编码 | `optimizeDependencies` 只处理 email 场景 | `planner.service.ts:203-231` | 非 email 场景无优化 |

## 设计目标

**通用编排引擎 + 可定制的 skill/prompt 层**

```
┌─────────────────────────────────────────┐
│            Prompt Templates              │  <- Prompt Registry 热更新
│  (场景化的 planning prompt 模板)          │
├─────────────────────────────────────────┤
│          Skill Constraints               │  <- Skill 管理 CRUD
│  (每个 skill 定义自己的 planning rules)   │
├─────────────────────────────────────────┤
│        Context Pipeline                  │  <- 可注册 context provider
│  (agent manifest, requirement, project)  │
├─────────────────────────────────────────┤
│     Generic Orchestration Engine         │  <- 核心引擎，场景无关
│  (plan → decompose → assign → execute)   │
├─────────────────────────────────────────┤
│       Post-Processing Pipeline           │  <- SceneOptimizationRule
│  (quality gate, scene optimization)      │
└─────────────────────────────────────────┘
```

## 实施计划

### 阶段一：Planning Context Pipeline（P0）

**目标**：解决 planner "盲飞"问题（L1/L3）

#### 步骤

1. **新增 `PlanningContextService`**
   - 路径：`backend/src/modules/orchestration/services/planning-context.service.ts`
   - 方法：`buildPlanningContext(prompt, requirementId?, plannerAgentId?)`
   - 聚合以下上下文：
     - Agent Manifest：可用 agent 列表 + 能力/工具摘要
     - Requirement Detail：从 EI 读取需求详情（title, description, priority, labels）
     - Planner Skill Constraints：planner agent 的 enabled skills 中与 planning 相关的约束
   - 输出结构化 context string

2. **改造 Planner Prompt 模板**
   - 路径：`backend/src/modules/orchestration/planner.service.ts`
   - 新增模板变量：`{{agentManifest}}`、`{{requirementDetail}}`、`{{planningConstraints}}`
   - 默认 prompt 增加"可用执行者"和"需求详情"区块
   - `renderPlannerPromptTemplate` 适配新变量

3. **改造 `generatePlanTasksAsync`**
   - 路径：`backend/src/modules/orchestration/orchestration.service.ts:210-414`
   - 在调用 `planFromPrompt` 前，先调用 `planningContextService.buildPlanningContext()`
   - 将 context 传入 planner

#### 影响范围
- 后端：`orchestration/` 模块（3 个文件改动 + 1 个新文件）
- 前端：无
- 数据库：无 schema 变更

### 阶段二：Skill-Driven Planning Constraint（P1）

**目标**：确保 skill 方法论被 planner 遵守（L2）

#### 步骤

1. **Skill Schema 扩展**
   - 路径：`backend/apps/agents/src/schemas/agent-skill.schema.ts`
   - 新增可选字段 `planningRules?: PlanningRule[]`
   - `PlanningRule` 类型：`{ type: 'task_count' | 'forbidden_task_pattern' | 'required_task_pattern' | 'dependency_rule', rule: string, validate?: string }`

2. **Constraint 提取与注入**
   - 在 `PlanningContextService.buildPlanningContext()` 中提取 planner agent 的 skill planning rules
   - 格式化为 `{{planningConstraints}}` 变量内容
   - 作为硬约束注入 planner prompt（而非背景知识）

3. **输出后校验 `validateAgainstSkillConstraints()`**
   - 路径：`backend/src/modules/orchestration/planner.service.ts`
   - planner 输出 JSON 后，逐条 task 检查是否违反 skill constraints
   - 违反时：自动修剪违规 task 或带校验错误重提交 planner

#### 影响范围
- 后端：`agents/schemas/`（schema 扩展）+ `orchestration/planner.service.ts`
- 数据库：`agent_skills` collection 新增可选字段（向后兼容）

### 阶段三：SceneOptimizationRule + Quality Gate（P2）

**目标**：将硬编码后处理逻辑改为可配置 pipeline（L4/L5）

#### 步骤

1. **SceneOptimizationRule 接口**
   - 抽象 `optimizeDependencies` 为 `SceneOptimizationRule` 接口
   - 每个 rule 定义：`{ scene: string, match: (tasks) => boolean, optimize: (tasks) => tasks }`
   - 内置 email 规则作为默认实现，可通过 DB 配置注册更多场景规则

2. **Task Description Quality Validator**
   - 可配置的最低质量标准
   - 检查项：description 最小长度、必须包含文件路径模式、禁止纯模板复述
   - 通过 Prompt Registry 或 DB 配置不同场景的 quality rules

3. **硬编码常量外置**
   - 任务数量上限（当前 8）→ 环境变量 `PLANNER_MAX_TASKS`
   - Title/Description 长度限制 → 环境变量
   - 执行者选择权重（40/30/20/10）→ 环境变量或 DB 配置
   - 最低匹配分数阈值（10）→ 环境变量

#### 影响范围
- 后端：`orchestration/planner.service.ts`、`executor-selection.service.ts`
- 数据库：可选新增 `scene_optimization_rules` collection

## 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Context Pipeline 增加 planning 延迟 | 计划创建变慢 | Agent Manifest 走 Redis 缓存，Requirement 单次查询 |
| Planner prompt 过长导致 token 超限 | LLM 截断或拒绝 | Agent Manifest 做摘要压缩，设置 max context length |
| Skill planningRules 需要为每个 skill 手动定义 | 运维成本 | 提供默认 rules 模板，支持从 skill content 自动提取 |
| 阶段二的输出校验可能导致 replan 循环 | planning 阶段超时 | 限制最大 replan 次数为 1 |

## 关键影响点

- **后端**：`orchestration/` 模块核心改动
- **API**：无对外接口变更（内部 pipeline 优化）
- **数据库**：阶段二需 `agent_skills` schema 扩展（向后兼容）
- **前端**：无
- **测试**：需新增 PlanningContextService 单测 + planner prompt 集成测试

## 验收标准

1. 阶段一：planner 输出的 task description 包含具体文件路径或接口信息（>60% 的 tasks）
2. 阶段二：skill 定义的 forbidden pattern 在输出中不出现
3. 阶段三：`optimizeDependencies` 可通过配置支持 code-dev 场景的依赖优化
