# Agent 管理工具选择自动赋权优化计划

## 背景

当前 Agent 管理页在编辑工具列表时，仅支持选择工具，不会直观展示工具依赖权限，也不会在前端侧自动补齐 `agent.permissions`。这会导致配置体验割裂：用户勾选了工具，但仍可能因为缺失 `requiredPermissions` 出现执行失败。

## 目标

1. 在 Agent 管理页工具列表中展示每个工具的 `requiredPermissions`。
2. 提供“自动赋权”开关，默认开启。
3. 开启时，勾选工具会自动聚合并补齐对应权限到 `agent.permissions`。
4. 关闭时，仅更新 `agent.tools`，不自动追加权限。

## 实施步骤

1. 梳理 Agent 编辑/创建弹窗中工具数据结构，确认从 `/tools` 接口可读取 `requiredPermissions`。
2. 在工具列表每个工具项下渲染“需要权限”标签，空权限显示“无需额外权限”。
3. 在工具管理区域增加“自动赋权（默认开启）”开关与说明文案。
4. 在保存逻辑中实现权限聚合：
   - 自动赋权开启：`nextPermissions = union(existingPermissions, requiredPermissions of selected tools)`
   - 自动赋权关闭：保持 `existingPermissions`（编辑）或空/已有值（创建）不变
5. 执行前端构建验证，确保类型检查与打包通过。

## 关键影响点

- 前端页面：`frontend/src/pages/Agents.tsx`
- 数据依赖：`/tools` 返回字段 `requiredPermissions[].id`
- 校验：`frontend npm run build`

## 风险与依赖

- 若工具元数据缺失 `requiredPermissions`，自动赋权可能不完整。
- 自动赋权策略采用“补齐不回收”，避免误删既有手工权限。
