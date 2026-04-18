# EditAgentModal API Keys 非数组崩溃修复

## 1. 基本信息

- 标题：EditAgentModal 中 `apiKeys.filter` 非函数导致页面崩溃
- 日期：2026-04-18
- 负责人：OpenCode
- 关联 Requirement：
- 所属 Feature：
- 需求管理 ID：
- OpenCode Session：
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：进入 Agent 编辑弹窗时报错 `TypeError: (apiKeys || []).filter is not a function`，页面渲染中断。
- 触发条件：`apiKeys` 查询结果不是数组（例如后端返回包装结构），组件直接调用 `.filter()`。
- 影响范围：`EditAgentModal` 与 `CreateAgentModal` 的 API Key 下拉过滤逻辑。
- 严重程度：中

## 3. 根因分析

- 直接原因：前端组件假设 `useQuery('apiKeys')` 返回数组，未对异常数据结构做兜底。
- 深层原因：`apiKeyService.getAllApiKeys/getApiKeysByProvider` 未对服务端返回结构进行归一化处理，导致调用方需要承受数据形态不稳定风险。
- 相关模块/文件：
  - `frontend/src/services/apiKeyService.ts`
  - `frontend/src/components/agents/EditAgentModal.tsx`
  - `frontend/src/components/agents/CreateAgentModal.tsx`

## 4. 修复动作

- 修复方案：在 service 层统一将 API Key 列表响应归一化为数组，并在组件层使用默认空数组与显式类型约束。
- 代码改动点：
  - `ApiKeyService` 新增 `normalizeApiKeyList`，兼容 `[]` / `{ data: [] }` / `{ items: [] }` 三类响应。
  - `getAllApiKeys` 与 `getApiKeysByProvider` 统一返回归一化后的数组。
  - `EditAgentModal` 与 `CreateAgentModal` 将 `useQuery` 声明为 `useQuery<ApiKey[]>`，并设置 `data` 默认值 `[]`。
- 兼容性处理：当接口返回未知结构时，安全回退为 `[]`，避免前端崩溃。

## 5. 验证结果

- 验证步骤：在 `frontend/` 执行 `npm run build`（`tsc && vite build`）。
- 验证结论：通过
- 测试与检查：
  - TypeScript 编译通过。
  - Vite 构建通过。
  - 仅存在既有包体积告警，不影响本次修复。

## 6. 风险与后续

- 已知风险：若后端后续改为其他包装字段（非 `data/items`）仍会回退为空数组，需要同步扩展归一化规则。
- 后续优化：可在 API 层统一响应 schema，并在前端增加 runtime schema 校验（如 zod）以尽早暴露契约偏差。
- 是否需要补充功能文档/API文档：否
