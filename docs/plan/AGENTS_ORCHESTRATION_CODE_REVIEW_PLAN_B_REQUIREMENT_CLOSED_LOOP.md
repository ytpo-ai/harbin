# [已弃用] AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_B_REQUIREMENT_CLOSED_LOOP

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Plan B - requirement 闭环修复（P0）

## 1. 目标

修复编排任务与需求状态同步不一致问题，建立统一、可预测、可回放的 requirement 状态闭环。

## 2. 范围与非目标

### 范围

- `backend/src/modules/orchestration/orchestration.service.ts`
- Plan/Task 与 requirement 状态回写逻辑
- 编排入口一致性与状态机集成测试

### 非目标

- 不在本计划内优化任务分类算法（Plan D）
- 不在本计划内处理调度器架构问题（Plan D/F）

## 3. 对应问题

- 1.1（requirementId 关联缺陷）
- N-10（`review -> done` 即时跳转）
- N-11（多入口未触发需求同步）

## 4. 前置依赖

1. 明确 requirement 状态机规范（todo/assigned/in_progress/review/done/blocked）
2. 明确 review 审批动作的 API 入口与责任方
3. 历史 Plan 数据兼容策略（metadata requirementId 迁移或双读）

## 5. 分阶段执行

### Phase B1 - 状态同步入口收敛

1. 将需求状态同步统一收敛到 `refreshPlanStats()` 后置钩子
2. 收敛后禁止其他路径直接写 requirement 状态
3. 增加状态计算日志（planId/taskId/oldStatus/newStatus/source）

### Phase B2 - 漏同步入口补齐

补齐以下入口的同步触发：

1. `retryTask`
2. `debugTaskStep`
3. `completeHumanTask`
4. `executeStandaloneTask`

### Phase B3 - review 门控与 requirementId 统一

1. 拆分 `review` 与 `done`：禁止自动即时跳转
2. 增加审批动作或显式确认动作后才可进入 `done`
3. 将 `requirementId` 提升为 Plan 一级字段，统一类型（避免 string/ObjectId 双轨）

### Phase B4 - 测试与数据兼容

1. 新增集成测试覆盖四类入口
2. 覆盖完整状态流转：`todo -> assigned -> in_progress -> review -> done`
3. 对历史数据提供迁移脚本或双读兼容逻辑

## 6. 问题映射表

| 问题 | 解决动作 | 核心文件 |
|---|---|---|
| 1.1 | requirementId 提升为一级字段 + 统一类型 | `backend/src/modules/orchestration/orchestration.service.ts` |
| N-10 | `review` 审批门控，禁止自动 done | `backend/src/modules/orchestration/orchestration.service.ts` |
| N-11 | `retry/debug/human/standalone` 全入口补同步 | `backend/src/modules/orchestration/orchestration.service.ts` |

## 7. 验收标准（量化）

1. 所有任务完成路径 100% 触发需求状态同步
2. `review` 状态可停留且仅由审批动作推进到 `done`
3. `requirementId` 无 string/ObjectId 双轨转换辅助函数残留
4. 编排闭环相关集成测试全部通过

## 8. 验证命令

在 `backend/` 执行：

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run build
npm run test -- --runInBand
```

若存在 orchestration 定向测试，可先定向再全量。

## 9. 风险、灰度与回滚

### 风险

- 状态机变更可能影响既有自动化流程
- 历史数据迁移不完整会导致状态回写异常

### 灰度

- 先灰度到测试计划（非生产 requirement）
- 对比灰度前后状态轨迹一致性

### 回滚

- 保留旧 requirementId 读取兼容（限时）
- 状态机门控支持临时降级开关（紧急恢复）
