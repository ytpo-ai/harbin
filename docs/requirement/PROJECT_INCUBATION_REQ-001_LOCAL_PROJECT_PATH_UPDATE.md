# Requirement: PROJECT_INCUBATION_REQ-001_LOCAL_PROJECT_PATH_UPDATE

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [PROJECT_ INCUBATION](../feature/PROJECT_%20INCUBATION.md) |
| 所属 Plan | [PROJECT_MANAGEMENT_LOCAL_PROJECT_PATH_UPDATE_PLAN](../plan/PROJECT_MANAGEMENT_LOCAL_PROJECT_PATH_UPDATE_PLAN.MD) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-review |
| 创建日期 | 2026-04-20 |
| 最后更新 | 2026-04-20 |

## 2. 需求描述

### 2.1 背景

项目管理中的本地项目仅支持创建，不支持后续路径调整。实际使用中项目目录可能迁移或修正，缺少路径修改能力会导致绑定与模板初始化流程受阻。

### 2.2 目标

在项目管理中支持本地项目路径修改，保证前后端交互闭环与路径安全校验，且不破坏现有绑定关系。

### 2.3 验收条件

- [x] 本地项目列表支持触发“修改路径”操作并弹窗编辑。
- [x] 后端提供本地项目路径更新接口，且仅允许 `sourceType=local` 的项目更新路径。
- [x] 更新接口完成最小安全校验（非空、绝对路径、可访问、路径冲突）并返回明确错误提示。
- [x] 修改成功后页面列表与详情实时刷新，展示新路径。

## 3. 技术方案摘要

在 EI 项目管理链路新增“路径更新”专用接口，服务层复用路径规范化逻辑并补充目录可访问性校验，前端在本地项目列表增加编辑入口和提交反馈。

### 影响范围

- **后端**：DTO、Controller、Service（projects/management）
- **前端**：rdConversationService、ProjectManagement 页面交互
- **数据库**：复用 `ei_projects.localPath` 字段，无 schema 结构变更
- **API**：新增本地项目路径更新端点

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/PROJECT_INCUBATION_REQ-001_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 路径更新接口保持最小影响面，不承载其他字段更新。
