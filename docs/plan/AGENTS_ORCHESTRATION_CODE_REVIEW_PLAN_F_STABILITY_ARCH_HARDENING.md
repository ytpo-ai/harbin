# [已弃用] AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_F_STABILITY_ARCH_HARDENING

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Plan F - 稳定性与架构加固（二期，P2-P3）

## 1. 目标

在多实例与长期演进场景下提升一致性、可观测性与配置治理能力，避免“单实例可用、多实例失效”。

## 2. 范围与非目标

### 范围

- 编排、调度、runtime、tools 的内存锁与内存状态
- ConfigModule 配置收敛与启动校验
- Tool/Toolkit 边界与状态语义统一
- 异步失败与调度失败告警体系

### 非目标

- 不在本计划内做业务功能扩展
- 不在本计划内做 UI 层改造

## 3. 对应问题

- 1.3 / 1.6（内存锁问题）
- N-20（多处内存状态无跨实例方案）
- N-22（环境变量散落）
- N-34 / N-35（Toolkit/Tool 边界与状态语义混乱）

## 4. 前置依赖

1. 架构评审确定锁方案（Redis 锁或 Mongo 乐观锁）
2. 架构评审确定 Tool/Toolkit 方向（领域化或派生化）
3. 监控平台接入方案确定（日志、指标、告警渠道）

## 5. 分阶段执行

### Phase F1 - 多实例一致性改造

1. 将 `runningPlans/runLocks/lockTails/rateLimitHits/circuitBreakers` 迁移到分布式状态
2. 加入锁 TTL、续约、超时释放与幂等保护
3. 验证多副本并发场景下不重复执行

### Phase F2 - 配置治理

1. 环境变量收敛到 ConfigModule（分域配置）
2. 补齐 schema 校验与默认值策略
3. 清理业务代码中的散落 `process.env` 直接读取

### Phase F3 - Tool/Toolkit 边界统一

1. 二选一落地：
   - 领域化（Toolkit 作为策略容器）
   - 派生化（移除持久化 Toolkit）
2. 统一 Tool 状态语义（`enabled/status/deprecated` 主口径）
3. 执行链路按统一口径生效

### Phase F4 - 可观测性加固

1. 异步失败（`runPlanAsync`）、cron 解析失败、重试超限全部告警
2. 增加关键指标：锁冲突率、重试次数、死信量、执行时延
3. 输出运行手册（故障定位与恢复步骤）

## 6. 问题映射表

| 问题 | 解决动作 | 关键模块 |
|---|---|---|
| 1.3/1.6/N-20 | 分布式锁与状态持久化 | orchestration/scheduler/runtime/tools |
| N-22 | ConfigModule 收敛 + 启动校验 | agents + orchestration |
| N-34/N-35 | Tool/Toolkit 边界与状态语义统一 | tools/toolkit 相关模块 |

## 7. 验收标准（量化）

1. 多实例下无重复执行与锁失效问题
2. 关键配置 100% 通过启动校验
3. Tool/Toolkit 执行口径统一，可解释且可测试
4. 关键异常路径具备告警与定位信息

## 8. 验证命令

在 `backend/` 执行：

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run build
npm run test -- --runInBand
```

并补充多实例并发压测与故障演练脚本。

## 9. 风险与回滚

### 风险

- 锁方案选型直接影响性能和一致性
- 边界决策不稳定会造成反复重构

### 回滚

- 锁与状态改造采用“旁路开关 + 渐进切换”
- Tool/Toolkit 策略变更保留兼容层，避免一次性切断
