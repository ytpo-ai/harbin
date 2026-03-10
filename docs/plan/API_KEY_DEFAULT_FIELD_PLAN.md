# API Key 管理优化 - 增加默认/弃用字段与可编辑能力

## 1. 需求背景

为API Key管理系统增加 `isDefault` 字段（表示该API-key是某个provider的默认API-key）与 `isDeprecated` 字段（表示该API-key已弃用）。同时支持前端编辑名称、provider、默认、弃用。

## 2. 技术方案

### 2.1 数据库Schema更新

**文件**: `backend/src/shared/schemas/apiKey.schema.ts`

- 添加 `isDefault` 字段 (boolean, default: false)
- 添加 `isDeprecated` 字段 (boolean, default: false)
- 添加索引：`{ provider: 1, isDefault: 1 }` 用于快速查询默认key

### 2.2 后端服务逻辑更新

**文件**: `backend/src/modules/api-keys/api-key.service.ts`

- 更新接口定义：
  - `CreateApiKeyDto`: 添加 `isDefault?: boolean`
  - `UpdateApiKeyDto`: 添加 `isDefault?: boolean`
  - `CreateApiKeyDto`: 添加 `isDeprecated?: boolean`
  - `UpdateApiKeyDto`: 添加 `isDeprecated?: boolean`
  - `ApiKeyResponse`: 添加 `isDefault: boolean`、`isDeprecated: boolean`

- 更新 `createApiKey` 方法：
  - 如果 `isDefault: true`，先清除同provider的其他默认key
  - 确保每个provider最多只有一个默认key

- 更新 `updateApiKey` 方法：
  - 处理默认状态变更
  - 如果设置为默认，清除同provider的其他默认key
  - 允许更新名称、provider、弃用状态

### 2.3 前端API接口更新

**文件**: `frontend/src/services/apiKeyService.ts`

- 更新 `ApiKey` 接口，添加 `isDefault: boolean`、`isDeprecated: boolean`
- 更新 `CreateApiKeyDto` 和 `UpdateApiKeyDto` 接口，添加 `isDefault?: boolean`、`isDeprecated?: boolean`

### 2.4 前端UI更新

**文件**: `frontend/src/pages/ApiKeys.tsx`

- 在API Key列表中显示默认/弃用状态（"默认"、"已弃用"标签）
- 在添加/编辑模态框中添加默认、弃用选项（复选框）
- 允许编辑名称、provider
- 确保UI逻辑正确处理默认与弃用状态
- Agent 选择 API Key 时过滤掉已弃用项

### 2.5 文档更新

**文件**: `docs/technical/API_KEY_ENCRYPTION.md`

- 更新数据格式示例，添加 `isDefault`、`isDeprecated` 字段

## 3. 任务清单

- [ ] 更新数据库Schema添加isDefault/isDeprecated字段
- [ ] 更新后端服务逻辑处理默认/弃用与可编辑字段
- [ ] 更新前端API接口类型定义
- [ ] 更新前端UI显示默认/弃用与编辑能力
- [ ] 更新 Agent 页面 API Key 过滤逻辑
- [ ] 更新技术文档

## 4. 影响范围

### 后端
- API Key Schema
- API Key Service
- API Key Controller (如果需要)

### 前端
- API Key Service
- API Key 页面组件

### 数据库
- 需要添加新字段，默认值为false

## 5. 风险与依赖

### 风险
- 并发情况下默认API-key的唯一性问题
- 现有数据兼容性（`isDefault`、`isDeprecated` 默认值为 `false`）

### 依赖
- 无特殊依赖

## 6. 测试要点

- 创建API Key时设置默认/弃用状态
- 更新API Key时修改默认/弃用状态
- 确保每个provider只能有一个默认API-key
- 前端UI正确显示默认/弃用状态
- Agent 选择时不展示已弃用 API Key

## 7. 相关代码文件

### 后端代码
- `backend/src/shared/schemas/apiKey.schema.ts`
- `backend/src/modules/api-keys/api-key.service.ts`

### 前端代码
- `frontend/src/services/apiKeyService.ts`
- `frontend/src/pages/ApiKeys.tsx`

### 文档
- `docs/technical/API_KEY_ENCRYPTION.md`
