# Agent Role HR Hardcut Plan

## 1. 背景与目标

- 将“角色（Role）”从 Agent 内核属性中剥离，归属到 legacy backend 的 HR 业务域管理。
- 前端角色管理入口放在 HR 页面，不在 Agent 模块内维护角色主数据。
- Agent 创建/编辑通过跨服务接口获取角色列表，并强制使用 `roleId`（必填）。
- 本次采用硬切换（hardcut）：**不做历史数据迁移**，直接切换新契约。

## 2. 范围

### 2.1 In Scope

- legacy backend（`backend/src/modules/hr`）新增角色模型与管理 API。
- agents service（`backend/apps/agents`）接入角色查询接口，并在创建/更新时强制校验 `roleId`。
- 前端：
  - `HRManagement` 新增角色管理能力。
  - `Agents` 创建/编辑移除旧角色自由输入，改为必选角色。
- API 与功能文档同步更新。

### 2.2 Out of Scope

- 不做历史 `Agent.role` 数据迁移。
- 不提供旧角色字段到新角色实体的自动映射。
- 不引入独立“角色权限系统”（RBAC）；仅表达业务能力角色。

## 3. 设计原则

- 角色是业务能力集合，不是 Agent 运行时必要内核。
- 单一事实来源（SSOT）：角色主数据只在 legacy HR 保存。
- agents service 仅保存角色引用（`roleId`）与最小必要展示信息。
- 失败快速：跨服务角色校验失败时，Agent 创建/更新直接失败。

## 4. 执行步骤

1. **legacy HR 侧落地角色管理**
   - 新增 `agent-role` schema、service、controller。
   - 提供角色 CRUD 与列表查询接口。
2. **agents service 强制 roleId**
   - Agent schema/类型改为 `roleId` 必填。
   - 创建与更新路径增加跨服务角色存在性校验。
   - 清理旧 `role` 读写路径。
3. **前端硬切换**
   - HR 页面新增角色管理 Tab（列表/新增/编辑/启停）。
   - Agent 创建/编辑改为角色下拉必选，无角色不可提交。
4. **文档与契约对齐**
   - 更新 API 文档与功能文档，标注破坏性变更。
5. **质量校验**
   - 运行 lint/typecheck/build（按前后端范围）并修复阻塞问题。

## 5. 关键影响点

- 后端（legacy HR）：新增角色主数据与 API。
- 后端（agents）：Agent 契约变更为 `roleId` 必填，新增跨服务依赖。
- 前端：HR 与 Agent 页面表单、类型与 API 调整。
- 数据库：角色新集合；Agent 字段结构变化。
- 文档：features/api 需同步硬切换说明。

## 6. 风险与应对

- 风险：历史 Agent 无 `roleId` 导致更新失败。
  - 应对：明确为硬切换预期行为，在发布说明中声明。
- 风险：跨服务接口不可用导致 Agent 创建失败。
  - 应对：前端增加明确错误提示，后端返回可诊断错误信息。
- 风险：`role` 概念混淆（业务角色 vs runtime 权限角色 vs meeting 参会角色）。
  - 应对：文档统一术语并在接口注释中显式区分。

## 7. 验收标准

- HR 页面可完整管理角色（增删改查/启停）。
- Agent 创建/编辑必须选择 `roleId`，后端强制校验。
- agents service 不再依赖旧 `role` 字段完成主流程。
- API/功能文档已更新并与实现一致。

## 8. 增量任务（agent_type 初始化与回填）

- 依据 `frontend/src/config/agentType.json` 建立标准角色种子，按 `agentType -> defaultRole(code)` 生成/对齐 HR 角色。
- 提供幂等同步入口：可重复执行，不重复创建角色。
- 在同步流程中可选执行 Agent 回填：按 `agent.type` 映射角色并写入 `roleId`。
- 输出执行摘要：角色创建数、更新数、Agent 回填数、未匹配 type 列表与失败明细。
