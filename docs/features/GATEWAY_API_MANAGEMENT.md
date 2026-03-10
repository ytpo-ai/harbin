# API 管理

## 1. 功能设计
- 目标：集中管理各模型提供商的 API Key，支持默认与弃用标记，保障调用安全
- 数据结构：ApiKey（id、name、provider、keyEncrypted、isActive、isDefault、isDeprecated、useCount、expiresAt、timestamps）
- 核心逻辑：API Key 加密存储；同 provider 仅允许一个默认 key；弃用标记用于前端过滤

## 2. 相关文档
- 规划文档：`docs/plan/API_KEY_DEFAULT_FIELD_PLAN.md`
- 开发总结：`docs/development/API_KEY_DEFAULT_FIELD_DEVELOPMENT.md`
- 技术文档：`docs/technical/API_KEY_ENCRYPTION.md`
- API文档：暂无（待补充）

## 3. 相关代码文件
- 后端代码：
  - `backend/src/shared/schemas/apiKey.schema.ts`
  - `backend/src/modules/api-keys/api-key.service.ts`
  - `backend/src/modules/api-keys/api-key.controller.ts`
- 前端代码：
  - `frontend/src/services/apiKeyService.ts`
  - `frontend/src/pages/ApiKeys.tsx`
  - `frontend/src/pages/Agents.tsx`
