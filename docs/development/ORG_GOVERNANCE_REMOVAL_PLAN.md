# 组织管理与公司治理模块下线开发总结

## 背景

按需求下线当前“组织管理”和“公司治理”模块的前后端功能代码，为后续重构腾出清晰边界，并保证现有系统主流程可构建。

## 本次改动范围

### 1) 前端下线

- 删除页面：
  - `frontend/src/pages/Organization.tsx`
  - `frontend/src/pages/Governance.tsx`
- 删除服务与状态：
  - `frontend/src/services/organizationService.ts`
  - `frontend/src/services/governanceService.ts`
  - `frontend/src/stores/organizationStore.ts`
- 路由与导航调整：
  - `frontend/src/App.tsx` 移除模块页面路由，并将 `/organization` 与 `/governance` 重定向到首页
  - `frontend/src/components/Layout.tsx` 移除左侧导航入口
- 类型清理：
  - `frontend/src/types/index.ts` 移除 Organization/Proposal 相关类型定义

### 2) 后端下线

- 删除组织管理模块：
  - `backend/src/modules/organization/organization.controller.ts`
  - `backend/src/modules/organization/organization.module.ts`
  - `backend/src/modules/organization/organization.service.ts`
- 删除公司治理模块：
  - `backend/src/modules/governance/governance.controller.ts`
  - `backend/src/modules/governance/governance.module.ts`
  - `backend/src/modules/governance/governance.service.ts`
- 删除治理数据模型：
  - `backend/src/shared/schemas/proposal.schema.ts`
- 模块装配与启动清理：
  - `backend/src/app.module.ts` 移除 Organization/Governance 模块注册
  - `backend/src/main.ts` 移除启动时组织初始化逻辑
- 类型清理：
  - `backend/src/shared/types.ts` 移除 Organization/Proposal 相关类型定义

### 3) 依赖解耦（防止删除后编译失败）

- HR 模块从组织服务依赖切换为员工数据模型驱动：
  - `backend/src/modules/hr/hr.module.ts`
  - `backend/src/modules/hr/hr.service.ts`
- 员工模块去除未使用的 Organization schema 注入：
  - `backend/src/modules/employees/employee.module.ts`
  - `backend/src/modules/employees/employee.service.ts`

## 文档同步

- `README.md`：标注组织管理/公司治理已下线
- `docs/api/API.md`：将组织管理与公司治理 API 标记为已下线并移除调试接口说明
- `docs/features/FUNCTIONS.md`：对应功能改为已下线待重构
- `docs/guide/USER_GUIDE.md`：流程与场景中移除提案/投票依赖描述
- `docs/README.md`：更新文档导航中的模块说明

## 验证结果

- 前端构建：通过
  - 命令：`frontend npm run build`
- 后端构建：通过
  - 命令：`backend npm run build`
- 后端 lint：未通过（仓库当前缺少 ESLint 配置，不属于本次改动引入）
- 后端测试：未通过（仓库现有 Jest/测试用例配置问题，不属于本次改动引入）

## 风险与后续建议

1. 历史数据兼容：数据库中组织/治理历史数据仍可能存在，后续重构建议规划迁移或归档策略。
2. 业务语义统一：当前 HR 已做“无组织模块”的兼容实现，重构组织域后建议重新对齐 HR 口径。
3. 重构落地建议：建议下一阶段先确定新领域模型（组织、股权、治理边界）后再重建 API 与前端页面，避免再次返工。

## 关联计划文档

- `docs/plan/ORG_GOVERNANCE_REMOVAL_PLAN.md`
