# 角色模块从 HR 独立计划

## 目标

- 将角色管理后端实现从 `hr` 模块剥离到独立 `roles` 模块。
- 角色接口从 `/hr/roles*` 迁移为 `/roles*`。
- Agent 侧跨服务角色查询改为调用独立角色接口。

## 执行步骤

1. 新增 `backend/src/modules/roles` 模块并迁移角色 CRUD 与同步逻辑。
2. 从 `hr` 模块删除角色路由与角色服务代码，保留纯 HR 能力。
3. 更新 legacy `AppModule` 注入 `RolesModule`。
4. 更新 agents 与 frontend 调用路径（`/hr/roles*` -> `/roles*`）。
5. 更新 API/开发文档并完成构建验证。

## 影响点

- Backend legacy：`roles` 模块新增，`hr` 模块收敛。
- Backend agents：角色校验与权限集查询改为新路由。
- Frontend：角色管理页面与服务改为调用 `/roles*`。

## 风险

- 旧调用路径失效风险：本次按需求直接切换，不保留 `/hr/roles*` 兼容。
