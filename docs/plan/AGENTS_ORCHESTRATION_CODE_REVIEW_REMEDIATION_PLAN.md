# AGENTS_ORCHESTRATION_CODE_REVIEW 修复总计划（执行总控）

本计划用于统一 A-F 子计划的执行口径，解决“目标明确但执行路径不够细”的问题。
对应问题来源：`docs/issue/AGENTS_ORCHESTRATION_CODE_REVIEW.md`。

## 1. 总目标

1. 先消除 P0 安全与闭环风险（可拒绝、可审计、可回滚）
2. 再做 P1/P2 结构重构（降复杂度、保行为等价）
3. 最后做治理与架构加固（多实例一致性、命名规范、可观测）

## 2. 执行计划索引

1. `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_A_SECURITY_AUTH_HOTFIX.md`
2. `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_B_REQUIREMENT_CLOSED_LOOP.md`
3. `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_C_AGENTS_REFACTOR_PHASE1.md`
4. `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_D_ORCHESTRATION_SCHEDULER_REFACTOR.md`
5. `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_E_SCHEMA_COLLECTION_GOVERNANCE.md`
6. `docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_F_STABILITY_ARCH_HARDENING.md`

## 3. 统一执行标准（所有子计划必须满足）

### 3.1 Definition of Ready（DoR）

- 问题编号、目标文件、目标行为三项齐全
- 已列出影响范围：后端/API/数据库/测试/文档
- 已定义灰度或回滚策略（涉及线上行为变更时）
- 已给出验证命令（build/lint/test 至少一项）

### 3.2 Definition of Done（DoD）

- 问题编号对应改动可追踪（问题 -> 提交/文件 -> 测试）
- 编译通过，关键测试通过
- 对外行为兼容（或文档明确记录破坏性变更）
- 新增配置项完成启动校验与文档说明

### 3.3 统一质量门禁

在 `backend/` 目录执行：

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run build:agents
npm run build
npm run test -- --runInBand
```

若为局部改动，可先跑对应模块定向测试，再补全全量回归。

## 4. 执行顺序与依赖

### 4.1 推荐顺序

- M1：Plan A -> Plan B（P0 风险先清零）
- M2：Plan C（已执行 Phase1，需补 Phase2 收口） + Plan D
- M3：Plan E（Schema/Collection 治理）
- M4：Plan F（持续演进）

### 4.2 并行建议

- 可并行：Plan C 与 Plan D 的“纯重构子项”
- 不建议并行：Plan A 与其他计划（安全策略变化会影响所有调用链）
- 强依赖：Plan E 的迁移脚本依赖 Plan B/D 的字段与调用口径稳定

## 5. 问题到计划映射（强约束）

| 问题编号 | 计划 | 目标状态 |
|---|---|---|
| N-17/N-30/N-31/N-32/N-33 | Plan A | 授权链强校验，密钥 fail-fast，主体可追踪 |
| 1.1/N-10/N-11 | Plan B | requirement 闭环一致，review 可停留 |
| N-1/N-2/N-3/N-5 | Plan C | agents 三大 God Class 实质性降行数 |
| N-4/N-6/N-12/N-13/N-27 | Plan D | orchestration/scheduler 去重复并增强失败治理 |
| N-28/N-29 | Plan E | collection 命名统一，双 schema 冲突消除 |
| 1.3/1.6/N-20/N-22/N-34/N-35 | Plan F | 多实例一致性 + 配置治理 + Tool/Toolkit 边界统一 |

## 6. Plan C 当前状态（本次评估结论）

- 已完成：拆出若干 handler/service 与 builtin catalog
- 未完成：`agent.service.ts` 核心执行链仍未迁出，`tool.service.ts` 仍有大量残留逻辑
- 结论：Plan C 视为“Phase1 部分达标”，需在 C 文档中追加 Phase2 收口任务与量化目标

## 7. 执行看板（维护字段）

| 计划 | 状态 | 负责人 | 目标周期 | 当前结论 |
|---|---|---|---|---|
| Plan A | pending | TBD | 1 周 | 待安全热修落地 |
| Plan B | pending | TBD | 1 周 | 待闭环状态机收敛 |
| Plan C | in_progress | TBD | 2-3 周 | Phase1 部分达成，需 Phase2 |
| Plan D | pending | TBD | 2 周 | 待重构与调度失败治理 |
| Plan E | pending | TBD | 1-2 周 | 待命名治理与迁移 |
| Plan F | pending | TBD | 持续 | 待架构决策后推进 |

## 8. 风险总览

- 鉴权加强可能导致历史隐式调用失败，需灰度与审计日志
- requirement 状态机收敛可能影响已有自动流转
- collection 重命名涉及数据迁移窗口与回滚预案
- 分布式锁与 Tool/Toolkit 边界需架构评审先定方向

## 9. 总体验收标准

- P0 问题修复完成且可回归验证
- P1/P2 重构项具备行为等价保障
- 数据模型与命名治理落地并纳入 CI 规则
- 多实例一致性和运行时可观测性得到增强
