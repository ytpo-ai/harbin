# PROJECT MANAGEMENT LOCAL PROJECT PATH UPDATE PLAN

## 1. 背景

- 当前“项目管理-本地项目”支持创建与绑定，但不支持修改已创建本地项目的路径。
- 本地项目路径在 OpenCode 同步、孵化项目模板初始化、需求项目关联中是关键上下文字段，错误路径会影响后续操作。

## 2. 目标

- 为本地项目提供“修改路径”能力，支持前端交互与后端接口闭环。
- 路径更新时提供必要校验（非空、绝对路径、目录可访问、重复冲突），避免脏数据。
- 保持现有绑定关系不变，仅更新本地项目路径字段。

## 3. 执行步骤

1. 新增本地项目路径更新 DTO 与 API（`PATCH /ei/projects/:id/local-path`），收敛为单一职责接口。
2. 在 EI 项目管理服务实现路径更新逻辑：校验项目类型为 `local`、校验路径合法性、检查冲突后落库。
3. 在前端 service 增加 `updateLocalProjectPath` 方法，打通路径更新调用。
4. 在项目管理页面“本地项目”列表增加“修改路径”入口与弹窗，支持编辑、提交、成功/失败反馈。
5. 补充文档追溯：新增 requirement 文档，并更新 feature/API 文档中的相关说明。

## 4. 关键影响点

- **后端/API**：`backend/apps/ei/src/controllers/projects.controller.ts`、`backend/apps/ei/src/services/projects.service.ts`、`backend/apps/ei/src/services/management.service.ts`、`backend/apps/ei/src/dto/management.dto.ts`
- **前端**：`frontend/src/services/rdConversationService.ts`、`frontend/src/pages/ProjectManagement.tsx`
- **文档**：`docs/requirement/`、`docs/feature/PROJECT_ INCUBATION.md`、`docs/api/engineering-intelligence-api.md`

## 5. Requirement 拆解

- REQ-001：本地项目支持路径修改。
  - 文档：`docs/requirement/PROJECT_INCUBATION_REQ-001_LOCAL_PROJECT_PATH_UPDATE.md`
  - 验收重点：可在项目管理页面修改本地项目路径；后端完成合法性与冲突校验；修改后列表实时刷新。

## 6. 风险与处理

- 风险：无效路径（不存在/无权限）被写入后影响下游能力。
  - 处理：更新接口执行目录可访问性校验，失败时返回明确错误。
- 风险：路径与其他本地项目冲突导致绑定错乱。
  - 处理：更新前做 `local + localPath` 冲突检查，冲突直接拒绝。
