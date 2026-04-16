# Fix 记录：需求列表排序倒序 & 项目过滤兼容 projectId

## 1. 基本信息

- 标题：需求列表排序倒序 & 项目过滤兼容 projectId
- 日期：2026-04-17
- 负责人：AI Agent
- 关联 Requirement：
- 所属 Feature：[研发需求管理](../../feature/ENGINEERING_INTELLIGENCE.md)
- 需求管理 ID：
- OpenCode Session：
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：前端需求列表页面看不到 GiftDesigner 项目通过 Agent 工具创建的需求
- 触发条件：
  1. 需求通过 Agent MCP 工具创建，只写入了 `projectId` 而未写入 `localProjectId`
  2. 需求列表默认排序为 `createdAt` 升序（最旧的在前），新创建的需求被排到最后一页
- 影响范围：所有通过 Agent 工具创建的需求在按项目过滤时不可见；新创建的需求默认不在首页
- 严重程度：高

## 3. 根因分析

- 直接原因：
  1. **排序方向错误**：`listRequirements` 排序为 `{ createdAt: 1 }`（升序），新需求排在末尾页
  2. **项目过滤字段不兼容**：后端只按 `localProjectId` 精确匹配，而 Agent 创建的需求只有 `projectId`，按项目过滤时被排除
- 深层原因：Agent 工具层 (`engineering-requirement-tool-handler.service.ts`) 创建需求时同时写入 `localProjectId` 和 `projectId`，但两者的值来源不同，部分场景下 `localProjectId` 为空
- 相关模块/文件：
  - `backend/apps/ei/src/services/requirements.service.ts` 第 404-461 行（listRequirements 方法）
  - `backend/apps/agents/src/modules/tools/builtin/engineering-requirement-tool-handler.service.ts` 第 206 行（createRequirement 写入逻辑）

## 4. 修复动作

- 修复方案：
  1. 将排序改为 `{ createdAt: -1, _id: -1 }`（降序），新需求排在首页
  2. 将 `localProjectId` 过滤逻辑改为 `$or: [{ localProjectId: value }, { projectId: value }]`，同时匹配两个字段
  3. 重构多个 `$or` 条件的组合逻辑，使用 `$and` 避免 `localProjectId` 过滤和 `search` 过滤互相覆盖
- 代码改动点：
  - `backend/apps/ei/src/services/requirements.service.ts`：`listRequirements` 方法
- 兼容性处理：
  - `projectId` 过滤同样做了 `$or` 双字段匹配
  - 当只有单个 `$or` 条件时直接 `Object.assign`，多个时用 `$and` 组合，无多余嵌套

## 5. 验证结果

- 验证步骤：
  1. TypeScript 类型检查：`npx tsc --noEmit` 通过
  2. 单元测试：`npx jest --testPathPattern="requirements.service.spec"` 2/2 通过
- 验证结论：通过
- 测试与检查：typecheck 零错误，单元测试全部通过

## 6. 风险与后续

- 已知风险：无
- 后续优化：
  - Agent 工具层创建需求时应确保 `localProjectId` 与 `projectId` 一致性，从源头减少不一致
  - 考虑对 `projectId` 和 `localProjectId` 做统一归一化（长期方向已在 schema 中标注 `projectId` 逐步替代 `localProjectId`）
- 是否需要补充功能文档/API文档：否
