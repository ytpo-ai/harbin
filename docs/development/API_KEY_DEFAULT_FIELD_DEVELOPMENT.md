# API Key 管理优化 - 开发总结

## 1. 需求概述
- 增加 API Key 默认与弃用字段
- 支持前端编辑名称、provider、默认、弃用
- Agent 选择 API Key 时过滤弃用项

## 2. 实现要点
- 后端 Schema 增加 `isDefault`/`isDeprecated`，服务层扩展 DTO 与响应结构
- 默认 key 变更时清理同 provider 其他默认项，保障唯一性
- 前端列表与表单支持默认/弃用展示与编辑
- Agent 选择 API Key 过滤 `isActive && !isDeprecated`

## 3. 关键改动
- `backend/src/shared/schemas/apiKey.schema.ts`
- `backend/src/modules/api-keys/api-key.service.ts`
- `frontend/src/services/apiKeyService.ts`
- `frontend/src/pages/ApiKeys.tsx`
- `frontend/src/pages/Agents.tsx`
- `docs/technical/API_KEY_ENCRYPTION.md`

## 4. 风险与注意事项
- provider 变更时默认 key 重新归属，需确保默认唯一性
- 弃用当前仅做过滤展示，不影响后端调用逻辑

## 5. 测试与验证
- 未运行完整测试
- `npm run lint` 失败：仓库根目录未提供 lint script（可执行 `npm run` 查看可用脚本）

## 6. 相关文档
- 规划文档：`docs/plan/API_KEY_DEFAULT_FIELD_PLAN.md`
