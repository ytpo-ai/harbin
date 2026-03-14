# Plan E - Schema 命名与模型一致性治理（P1）

## 1. 目标

统一 Mongo collection 命名规范并消除模型冲突，避免默认复数化导致的命名漂移和运行时不确定性。

## 2. 范围与非目标

### 范围

- `backend/src/shared/schemas/**`
- `backend/apps/agents/src/schemas/**`
- `backend/apps/engineering-intelligence/src/schemas/**`
- 迁移脚本、兼容策略、CI 校验规则

### 非目标

- 不在本计划内重构业务服务逻辑
- 不在本计划内替换数据库引擎或访问层

## 3. 对应问题

- N-28（未显式声明 collection，命名漂移）
- N-29（`AgentSession` 双 schema 定义冲突）

## 4. 前置依赖

1. 产出全量 schema 清单与当前 collection 名
2. 确认命名规范：统一 `module_model`（snake_case）
3. 确认迁移窗口与回滚窗口

## 5. 分阶段执行

### Phase E1 - 规范固化（不迁移数据）

1. 所有 schema 显式声明 `collection`
2. 新增规范文档与命名映射表（旧名 -> 新名）
3. CI 增加校验：禁止新增未声明 collection

### Phase E2 - 高风险冲突优先修复

1. 优先收敛 `AgentSession` 双定义冲突
2. 统一单一 schema 来源与字段定义
3. 验证模型注册顺序不再影响运行结果

### Phase E3 - 数据迁移与兼容

1. 生成迁移脚本（可重复执行、幂等）
2. 低峰执行 collection rename/migrate
3. 灰度期提供双读或兼容映射
4. 校验读写一致性后移除兼容逻辑

## 6. 问题映射表

| 问题 | 解决动作 | 核心文件 |
|---|---|---|
| N-28 | 全量 schema 显式 collection + CI 校验 | `backend/src/shared/schemas/**`, `backend/apps/**/schemas/**` |
| N-29 | AgentSession 单一定义收敛 | `backend/src/shared/schemas/agent-session.schema.ts`, `backend/apps/agents/src/schemas/agent-session.schema.ts` |

## 7. 验收标准（量化）

1. schema 显式 collection 覆盖率达到 100%
2. `AgentSession` 双 schema 冲突消除
3. 迁移后关键查询/写入路径无异常
4. CI 能阻断未声明 collection 的新增 schema

## 8. 验证命令

在 `backend/` 执行：

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run build
npm run test -- --runInBand
```

另外需执行迁移前后数据一致性校验脚本（按项目脚本目录落地）。

## 9. 风险、灰度与回滚

### 风险

- 线上迁移可能影响历史查询路径
- 双读兼容期过长会增加维护成本

### 灰度

- 先迁移低风险集合并验证
- 再迁移高流量集合

### 回滚

- 每批迁移保留回滚脚本与快照
- 发现异常立即回退到旧 collection 映射
