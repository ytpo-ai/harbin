# Plan C - Agents 核心服务拆分（P0-P1）

## 1. 目标

降低 `agents` 侧 God Class 复杂度，按职责拆分并收敛残留逻辑，确保“结构降复杂 + 行为等价”。

## 2. 范围与非目标

### 范围

- `backend/apps/agents/src/modules/tools/tool.service.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`
- `backend/apps/agents/src/modules/memos/memo.service.ts`
- 对应 handler/service、模块依赖注入、单元测试

### 非目标

- 不在本计划内解决 Tool/Toolkit 边界（Plan F）
- 不在本计划内处理 orchestration/scheduler 主体重构（Plan D）

## 3. 对应问题

- N-1（tool.service God Class）
- N-2（agent.service God Class）
- N-3（memo.service God Class）
- N-5（detailed/streaming 执行链重复）

## 4. 当前状态评估（截至本次 review）

### 已完成（Phase1）

1. 提取 `builtin-tool-catalog.ts` 与 `builtin-tool-definitions.ts`
2. 提取 `InternalApiClient`
3. 提取 `OrchestrationToolHandler`、`RequirementToolHandler`、`RepoToolHandler`
4. 提取 `ToolGovernanceService`
5. 提取 `MemoTaskTodoService` 与 `MemoTaskHistoryService`

### 未完成（关键收口）

1. `AgentExecutionService` 提取深度不足，执行主链仍在 `agent.service.ts`
2. `tool.service.ts` 仍有大量残留私有实现和巨型分发压力
3. `memo.service.ts` 任务历史写入仍集中，未完全服务化

### 本次推进（2026-03-14）

1. **Phase C1 首轮收口（已落地）**
   - `AgentExecutionService` 新增 runtime 公共模板能力：
     - `startRuntimeExecution`（runtime 初始化与 metadata 组装）
     - `completeRuntimeExecution` / `failRuntimeExecution` / `releaseRuntimeExecution`（完成/失败/释放收尾）
   - `agent.service.ts` 的 `executeTaskDetailed/executeTaskWithStreaming` 改为复用上述公共模板，删除重复 `startRun/completeRun/failRun/releaseRun` 代码路径。
2. **执行链重复继续收敛（已落地）**
   - 抽取 `resolveCustomApiKey`，统一 detailed/streaming API Key 获取、使用记录与降级日志逻辑。
3. **验证结果（已通过）**
   - `npm run build:agents`
   - `npm test -- apps/agents/src/modules/tools/tool.service.spec.ts apps/agents/src/modules/agents/agent.service.spec.ts apps/agents/src/modules/memos/memo.service.spec.ts --runInBand`

4. **Phase C2 收口推进（已落地）**
   - `tool.service.ts` 将 `orchestration/requirement/repo` 分发从主 `switch` 中抽为独立薄分发：
     - `dispatchOrchestrationToolImplementation`
     - `dispatchRequirementToolImplementation`
     - `dispatchRepoToolImplementation`
   - 删除已迁移到 handler 的冗余私有实现（requirements/orchestration 大段旧逻辑），保留薄分发层与必要兼容方法。

## 5. 量化目标（Phase2 收口）

1. `tool.service.ts` 目标：`<= 1500` 行（本阶段现实目标）
2. `agent.service.ts` 目标：`<= 2200` 行
3. `memo.service.ts` 目标：`<= 1100` 行
4. `executeTaskDetailed/executeTaskWithStreaming` 公共流程复用率 >= 70%
5. 不新增循环依赖，模块编译通过

## 6. 分阶段执行

### Phase C1 - Agent 执行主链抽取

1. 将执行共性流程下沉到 `AgentExecutionService`：
   - runtime 初始化
   - model 配置构建
   - system message 入会话
   - 完成/失败收尾
2. `executeTaskDetailed/executeTaskWithStreaming` 保留模式差异，复用公共模板

### Phase C2 - ToolService 残留逻辑收口

1. 删除已迁移 handler 的冗余私有方法（确保无调用后移除）
2. 将分发逻辑按领域拆组（至少剥离 orchestration/requirement/repo）
3. 保留 `executeToolImplementation` 作为薄分发层

### Phase C3 - Memo 领域继续拆分

1. 将 history upsert 合并策略继续下沉到 `MemoTaskHistoryService`
2. `memo.service.ts` 保留编排入口，不保留复杂渲染/归一化细节

### Phase C4 - 行为等价回归

1. 补全拆分后的单测（尤其是迁出方法的输入边界）
2. 覆盖 TODO/history 关键状态路径
3. 覆盖 tool 分发关键路径

## 7. 问题映射表

| 问题 | 解决动作 | 核心文件 |
|---|---|---|
| N-1 | 拆分 tool 领域逻辑 + 移除残留实现 | `backend/apps/agents/src/modules/tools/tool.service.ts` |
| N-2 | 提升 AgentExecutionService 承载度 | `backend/apps/agents/src/modules/agents/agent.service.ts` |
| N-3 | memo 任务历史逻辑继续下沉 | `backend/apps/agents/src/modules/memos/memo.service.ts` |
| N-5 | detailed/streaming 流程模板化 | `backend/apps/agents/src/modules/agents/agent.service.ts` |

## 8. 验收标准（量化）

1. 三个核心文件达到本计划行数目标
2. `executeTaskDetailed/executeTaskWithStreaming` 重复显著下降
3. 核心行为等价（输入输出、错误码、审计字段不回退）
4. 相关单测/集成测试全部通过

## 9. 验证命令

在 `backend/` 执行：

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run build:agents
npm test -- apps/agents/src/modules/tools/tool.service.spec.ts apps/agents/src/modules/agents/agent.service.spec.ts apps/agents/src/modules/memos/memo.service.spec.ts --runInBand
```

## 10. 风险与回滚

### 风险

- 依赖注入改动多，容易引入循环依赖
- 迁移过程中方法签名不一致可能导致隐性行为漂移

### 回滚

- 每次只迁移一类职责（一次一个 handler/service）
- 若行为漂移，优先回退该类职责迁移，不回滚全部拆分
