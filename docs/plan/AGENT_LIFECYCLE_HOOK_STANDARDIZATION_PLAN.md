# Agent Lifecycle Hook 标准化设计 Plan

## 1. 背景与目标

### 现状问题

- **Step Hooks** 仅有 `before/after` 两个维度，硬编码在 `AgentExecutorService` 构造函数中
- **Task/ToolCall/Permission** 三个维度无 hook 拦截点，状态变更散落在 `RuntimeOrchestratorService` 和 `AgentTaskService` 中
- 新增 hook 必须修改核心服务源码，无法插件化扩展
- `HookDispatcherService` 仅负责事件 pub/sub，不具备拦截/增强/决策能力

### 目标

1. 建立 **统一的生命周期 Hook 协议**，覆盖 Task / Step / ToolCall / Permission 四个维度
2. 提供 **HookRegistry 动态注册中心**，支持运行时 register/unregister
3. 提供 **HookPipeline 调度器**，按优先级串行执行已注册 hooks，支持中断/增强/透传
4. 现有 step hooks 无损迁移到新体系
5. 为后期插件系统（如配置化启停、热加载）预留扩展点

## 2. 核心设计

### 2.1 统一 Hook 协议

四个维度共享统一的基础协议（详见技术设计文档）：

- `LifecyclePhase`：Task / Step / ToolCall / Permission 阶段枚举
- `LifecycleHookContext`：统一上下文（phase + runId + agentId + payload）
- `LifecycleHookResult`：执行结果（action: continue/skip/abort + appendMessages + mutatedPayload）
- `LifecycleHook`：统一接口（id + phases + priority + matches + execute）

### 2.2 HookRegistry 动态注册中心

- `register(hook)` / `unregister(hookId)` 动态管理
- `getHooksForPhase(phase)` 按优先级排序返回
- `@LifecycleHookProvider()` 装饰器 + `OnModuleInit` 自动发现

### 2.3 HookPipeline 调度器

- 按优先级串行执行该阶段所有匹配 hooks
- `abort` 可中止后续执行
- `appendMessages` / `mutatedPayload` 累积传递
- 内置耗时日志与执行轨迹

### 2.4 与现有体系的关系

- `HookPipelineService`（新增）：**同步拦截层**，可修改执行行为
- `HookDispatcherService`（已有，不变）：**异步通知层**，负责 RuntimeEvent pub/sub

## 3. 执行步骤

| # | 步骤 | 关键影响点 | 预估 |
|---|------|-----------|------|
| 1 | 新建 `hooks/` 目录，定义统一协议类型 | 后端类型层 | 小 |
| 2 | 实现 `HookRegistryService` + `@LifecycleHookProvider()` 装饰器 | runtime module | 中 |
| 3 | 实现 `HookPipelineService` 调度器 | runtime module | 中 |
| 4 | 迁移 `AgentBeforeStepOptimizationHook` → `LifecycleHook` | agent module | 小 |
| 5 | 迁移 `AgentAfterStepEvaluationHook` → `LifecycleHook` | agent module | 小 |
| 6 | `AgentExecutorService` 改用 `pipeline.run()` | agent executor | 中 |
| 7 | `RuntimeOrchestratorService` 接入 pipeline（toolcall/permission） | runtime orchestrator | 中 |
| 8 | `AgentTaskService` / `AgentTaskWorker` 接入 pipeline（task lifecycle） | agent-tasks module | 中 |
| 9 | 补充单元测试 | 测试 | 中 |
| 10 | 更新功能文档 | 文档 | 小 |

## 4. 风险与应对

| 风险 | 应对 |
|------|------|
| Step hooks 迁移影响现有语义 | 保持 matches/run 逻辑不变，仅适配接口 |
| Pipeline 串行执行引入延迟 | hooks 默认 continue，仅 matches=true 时执行；内置耗时日志 |
| toolcall hooks abort 中断工具执行 | 初期仅允许 continue/skip，不开放 abort |
| 动态 unregister 并发安全 | Registry 内部 shallow copy 迭代 |

## 5. 相关文档

| 文档 | 路径 |
|------|------|
| 技术设计 | `docs/technical/AGENT_LIFECYCLE_HOOK_TECHNICAL_DESIGN.md` |
| 功能文档 | `docs/feature/AGENT_RUNTIME.md` |
