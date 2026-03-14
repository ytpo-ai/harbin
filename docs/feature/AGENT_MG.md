# Agent Management（Agent 管理）

## 1. 功能设计

### 1.1 目标

- 提供 Agent 的统一管理入口，支持创建、编辑、启停、删除与详情查看。
- 提供 Agent 列表可视化与角色信息聚合，便于快速识别人员职责与模型配置。
- 在创建流程中统一基础信息、模型设置与工具设置，降低配置错误。

### 1.2 核心交互

1. 列表展示：Agent 以人物卡片形式展示，包含头像、名称、角色、状态、模型与工具数量。
2. 头像兜底：当 Agent 未配置头像或头像加载失败时，展示默认头像。
3. 创建 Agent：在创建弹窗中先完成基础信息，再进行模型设置与工具设置；模型设置位于工具设置上方。
4. 快捷操作：每张卡片支持开始聊天、查看详情、启停、编辑、删除。
5. Config 编辑：创建/编辑弹窗新增 `config` JSON 输入区，初期采用纯 JSON 文本编辑，不引入结构化表单。
6. 工具权限可视化：创建/编辑 Agent 时，工具项显示 `requiredPermissions`，并提供“自动赋权”开关（默认开启），可在勾选工具时自动补齐 `agent.permissions`。

### 1.3 Agent Config 设计（本轮新增）

- 目标：为 Agent 提供统一可扩展配置承载，避免将执行策略硬编码在 prompt。
- 字段：`config`（JSON Object），默认 `{}`，历史数据缺失时按 `{}` 处理。
- 首批命名空间：
  - `execution`：执行通道与模型策略（provider/toolId/endpointRef/modelPolicy）。
  - `budget`：按 `agent + period` 的配额策略（period/limit/unit）。
- 约束：
  - 创建与更新均支持 `config` 入参。
  - 查询接口返回 `config` 原始对象，不做字段裁剪。
  - 后端执行最小结构校验，未知子键允许透传，为后续扩展预留空间。

### 1.4 状态与约束

- Agent 状态：`活跃` / `非活跃`，影响聊天入口可用性。
- 工具选择：白名单模式下，仅可选择当前角色工具权限集中允许的工具。
- 模型密钥：API Key 按模型 provider 过滤，仅展示匹配且活跃的密钥。
- Config 兼容：当 `config` 缺失或为空对象时，不影响历史 Agent 管理与执行流程。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `AGENT_MANAGEMENT_PERSON_CARD_UI_PLAN.md` | Agent 管理页人物卡片与创建顺序优化计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| (待补充) | Agent 管理页人物卡片与创建顺序优化开发总结 |

### 技术/接口文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `plan/AGENT_CONFIG_JSON_EXTENSION_PLAN.md` | Agent `config` 字段扩展计划 |
| `api/agents-api.md` | Agent 创建/更新/查询接口口径 |
| `technical/OPENCODE_EI_DATA_LAYER_TECHNICAL_DESIGN.md` | OpenCode 门禁与配额前置校验约束 |

---

## 3. 相关代码文件

### 前端页面 (frontend/src/pages/)

| 文件 | 功能 |
|------|------|
| `Agents.tsx` | Agent 管理主页面（人物卡片列表、创建/编辑弹窗） |

### 前端服务 (frontend/src/services/)

| 文件 | 功能 |
|------|------|
| `agentService.ts` | Agent 列表、创建、更新、删除、测试、权限集接口封装 |
