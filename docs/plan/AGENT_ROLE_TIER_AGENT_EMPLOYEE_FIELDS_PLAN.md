# Agent/Role/Employee Tier 治理落地计划

## 需求理解

- 基于 `docs/architecture/AGENT_ROLE_TIER_ARCHITECTURE.md`，将现有 `Agent`、`Role`、`Employee` 的角色治理从“角色名硬编码”升级为“tier 驱动”。
- 收敛角色数据源：`agents` 应用 legacy `/roles` 与主后端 `roles` 模块统一为单一 Role Registry。
- 统一 `EmployeeRole` 与 `AgentRole` 层级模型，建立稳定映射，避免两套体系并行演进。
- 当前阶段保持“轻审计”原则：审计字段最小化，不引入复杂事件流水。

## 分阶段执行步骤

### 阶段一：数据模型升级（先做）

1. 在共享 Schema 中为 `agent`、`employee`、`agent_role` 增加 `tier` 枚举字段（`leadership | operations | temporary`），补充索引与类型约束。
2. 建立统一映射表：`EmployeeRole -> tier`、`AgentRole.code -> tier`，并在服务层统一引用该映射源。
3. 收敛角色数据源到单一 Role Registry：移除/下沉 `agents` 侧 legacy 角色来源，统一通过主后端 roles 模块读写。
4. 更新角色 seed 与初始化逻辑：所有系统 roleCode 默认携带 tier，保证新环境初始化一致。
5. 更新 Agent/Employee 创建与更新接口：支持显式传入 `tier`，未传入时按角色映射回填，且校验与角色层级一致。
6. 提供迁移脚本（或启动迁移任务）批量补齐历史 `agent/employee/role` 的 tier，并输出迁移统计与异常清单。
7. 修复一致性问题 A：`employee.schema` 补充 `userId` 字段定义，与 `employee.service` 现有使用保持一致。
8. 修复一致性问题 B：专属助理自动创建默认 `roleId` 与角色 seed 统一，避免绑定失败。

### 阶段二：运行时守卫（后做）

1. 实现统一权限合并器：`tier baseline + role override`，替代 scattered 的角色名硬编码策略。
2. 将策略判断从“角色名”切换为“tier”：
   - `leadership` 默认具备会议创建、计划编排、网络检索能力。
   - `temporary` 默认禁止系统管理类工具。
   - `operations` 仅保留执行能力与向 `temporary` 分派能力。
3. 新增分派方向守卫：仅允许 `leadership -> operations/temporary`、`operations -> temporary`。
4. 分派被拒绝时返回架构文档定义的拒绝码（包含方向违规、tier 缺失/冲突、临时工工具越权等）。
5. 在冲突仲裁中统一使用 tier 规则（非角色名匹配）并保留最小可追溯上下文。

### 阶段三：编排、前端与轻审计收口（最后做）

1. 编排模块切换到 tier 模型（执行者选择、能力推断、分派链路判断）。
2. 前端类型与管理页面补齐 `tier` 展示与编辑能力，保障与 API 合同一致。
3. 任务/运行审计保持轻量：仅保留分派路径与关键授权标识字段，不新增复杂权限事件流。
4. 更新相关文档（功能文档、变更说明、日常日志），并补充回归测试。

## 关键影响点

- 后端 Schema/服务：`agent`、`employee`、`agent_role`、角色映射与运行时守卫逻辑。
- 角色数据源：`agents` 侧角色读取路径与主后端 roles 模块将合并为单一 Registry。
- API 合同：Agent/Employee/Role 的创建、更新、查询返回新增 `tier`，并增加守卫拒绝码返回。
- 编排与执行：执行者选择、工具访问、分派路径判断从 roleName/code 迁移到 tier。
- 前端管理端：Agent/Employee/Role 页面需要同步 `tier` 字段及校验提示。
- 测试与稳定性：涉及角色、员工、Agent 关联全链路，需要回归验证。

## 风险与依赖

- 历史数据 role/tier 可能缺失或异常，需定义兜底策略（默认 `operations` + 告警 + 迁移报表）。
- legacy `/roles` 下线需要灰度与兼容层，防止 agents 应用短期读角色失败。
- `EmployeeRole` 与 `AgentRole` 映射若不完整会触发 tier 冲突，需要先固化映射表与校验顺序。
- 前后端发布窗口需协调，避免后端新增字段后旧前端写入失败（建议按“可选 -> 必填”分阶段切换）。
- 分派守卫上线后可能影响现有自动化编排成功率，需准备回滚开关与告警监控。

## 验收标准

- 角色、员工、Agent 均可稳定读写 `tier`，且历史数据完成补齐。
- 角色数据仅从统一 Role Registry 获取，不再依赖 legacy 角色源。
- 运行时策略判断不再依赖角色名硬编码，核心路径由 tier 驱动。
- 分派方向违规可被拦截并返回架构文档定义的拒绝码。
- `employee.userId` 字段与专属助理默认 `roleId` 一致性问题修复完成并通过回归。
