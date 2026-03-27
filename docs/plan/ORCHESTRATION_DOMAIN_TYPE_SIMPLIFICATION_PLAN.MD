# ORCHESTRATION DOMAIN TYPE SIMPLIFICATION PLAN

## 背景

- 当前 Plan 数据同时存在 `domainContext`（含 `domainType`）与 `defaultTaskType`，字段职责重叠，且 `domainType` 还包含自动推断逻辑，语义不稳定。
- 用户要求收敛为显式的、独立的 `domainType` 字段，并删除 `defaultTaskType` 与 `domainContext` 相关逻辑。

## 目标

- 在 Orchestration Plan 中独立保留 `domainType` 字段。
- 创建 Plan 时 `domainType` 必选，默认 `general`，枚举仅保留：`general | development | research`。
- 细化 `development` 域下任务类型：`development.plan | development.exec | development.review`。
- 上述 3 类 `development.*` 任务默认不支持自动生成模式下的重试执行（auto-generate retry disabled by default）。
- taskType 不再支持：`development`、`review`、`code_review`、`email`、`planning`、`external_action`，相关逻辑统一清理。
- 删除 Orchestration 中对 `domainType` 的推断逻辑。
- 删除 `defaultTaskType` 和 `domainContext` 字段及其相关业务逻辑。
- 在 `plan.strategy` 新增执行模式 `runMode`（`once | multi`），默认 `multi`。
- `runMode=once` 时，仅允许在任务生成链路中执行，不允许后续手动重复运行；前端运行按钮禁用。

## 执行步骤

1. 更新 Plan Schema：新增/固化独立 `domainType`（三值枚举 + 默认 `general`），移除 `domainContext` 与 `defaultTaskType`。
2. 更新 DTO：`CreatePlanFromPromptDto/ReplanPlanDto/UpdatePlanDto` 仅保留三值 `domainType`，删除 `defaultTaskType` 入参与校验。
3. 更新 Plan 管理链路：创建/更新/重编排只使用显式 `domainType`，移除 `inferDomainContext` 及相关推断调用。
4. 更新执行链路：删除向 Agent SessionContext 透传的 `domainContext`，保留其他协作上下文字段。
5. 清理任务生成逻辑：移除 `plan.defaultTaskType` 兜底，且移除 planner 输出中的 `taskType` 依赖。
6. 将任务类型推断收敛到 `phasePreExecute`：基于 `domainType + sourcePrompt + task上下文` 推断并落库 `runtimeTaskType`。
7. 更新前端编排接口与页面：创建计划时显式提交 `domainType`（默认 `general`），移除 `defaultTaskType` 相关字段。
8. 更新文档与测试：同步 feature/guide/api 描述并完成关键链路验证。
9. 扩展 `strategy.runMode`：后端新增字段与运行守卫，前端新增配置项并在 `once` 下禁用运行按钮。
10. 扩展 `development` 子任务类型：在任务类型定义、校验、路由和展示层新增 `development.plan | development.exec | development.review`。
11. 更新自动生成重试策略：对 `development.*` 三类任务默认关闭自动重试，失败后进入显式人工处理/重编排路径。

## 影响点

- 后端：Orchestration Schema、DTO、PlanManagement、ExecutionEngine、IncrementalPlanning
- 后端：`runtimeTaskType` 枚举扩展与执行引擎重试策略（`development.*` 默认禁用自动重试）
- 后端：移除 `TaskClassificationService`，清理对任务类型关键词分类的依赖
- Agent Runtime：Orchestration 注入上下文结构
- 前端：Orchestration Service 和计划创建/编辑表单
- 前端：运行按钮可用性判定（once 模式禁用）
- 前端：任务类型标签、筛选项、调试下拉与可视化映射需支持 `development.*`
- 文档：`docs/feature`、`docs/guide`、`docs/api`

## 风险与依赖

- 字段删除属于破坏性变更，需确保前后端同批上线。
- 旧数据中保留的 `domainContext/defaultTaskType` 需按“可读但不再使用”策略处理。
- 若第三方或脚本依赖旧字段，需要同步改造请求体与读取逻辑。
- `development.*` 新值属于 taskType 兼容性变更，需同步更新白名单/归一化逻辑，避免被静默降级为 `general`。
- 自动重试策略收紧后，失败任务可能增多，需要配套明确人工接管与重编排流程。
- `phasePreExecute` 成为唯一分类入口后，分类策略改动需重点回归 pre/execute/post 三阶段联动行为。
