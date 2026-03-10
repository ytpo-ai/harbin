# 模型注册表元数据字段扩展计划

## 需求理解

- 现有模型数据结构仅支持基础参数（id/name/provider/model/maxTokens 等），不支持 `description` 与 `availability`。
- 需要新增 `deprecated` 字段，并按确认语义实现：`deprecated=true` 表示已弃用，`false`/缺省表示可用。

## 执行步骤

1. 扩展共享模型类型定义，在后端 contracts 与前端 types 中新增 `description`、`availability`、`deprecated` 可选字段，确保编译期类型一致。
2. 扩展后端 `ModelRegistry` 数据模型（Mongoose Schema），为新字段建模并设置 `deprecated` 默认值为 `false`。
3. 更新模型管理服务 `model-management.service.ts` 的创建、更新、输出映射流程，保证新增字段可以写入、更新和返回。
4. 更新模型管理前端页面 `Models.tsx`，在创建/编辑表单中支持填写 `description`、`availability` 与切换 `deprecated`，并在列表卡片展示核心元信息。
5. 执行针对性校验（至少前端/后端类型或构建检查之一），确认新增字段不会破坏现有流程。

## 关键影响点

- 后端：contracts 类型、Mongoose Schema、Model Management Service。
- 前端：`AIModel` 类型、模型管理页展示与表单。
- API：`/model-management/models` 创建与更新请求/响应结构会新增可选字段。
- 文档：本计划文档沉淀于 `docs/plan/`，便于后续开发总结复用。

## 风险与依赖

- 历史数据无新字段时需兼容（通过可选字段与默认值避免读取异常）。
- 前后端类型定义当前是分离维护，若一侧遗漏会导致联调不一致。
- `availability` 先按自由文本实现，后续若需要枚举化需额外迁移策略。
