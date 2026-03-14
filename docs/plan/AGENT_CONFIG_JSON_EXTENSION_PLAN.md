# Agent 通用 Config JSON 扩展计划

## 需求理解

- 目标：在 Agent 实体上增加一个通用 `config` JSON 字段，作为后续各类配置（研发工具、执行端点、模型策略、预算策略等）的统一承载。
- 约束：
  - 保持历史 Agent 兼容（`config` 可为空，默认 `{}`）。
  - 不把配置硬编码在 Prompt 中，统一通过运行时读取 `agent.config`。
  - 配置应支持后续扩展到更多研发工具（不仅限 OpenCode）。

## 方案范围

### In Scope

1. Agent 数据模型新增 `config` 字段（JSON 对象）。
2. Agent API 支持 `config` 读写（创建/更新/查询）。
3. 运行时预留 `config` 解析入口（用于执行前门禁）。
4. 文档更新（功能文档 + API 文档 + 当前 OpenCode 方案文档关联）。

### Out of Scope

1. 不在本阶段完成所有 `config` 子键业务逻辑。
2. 不在本阶段做完整可视化表单（可先 JSON 编辑）。
3. 不在本阶段做配置版本迁移工具（仅做兼容默认值）。

## 首批配置键约定（v1）

建议在 `config` 下定义命名空间：

```json
{
  "execution": {
    "provider": "opencode",
    "toolId": "opencode-dev",
    "endpointRef": "endpoint_ecds_01",
    "envPolicy": "both",
    "modelPolicy": {
      "bound": {
        "provider": "openai",
        "model": "gpt-5.3-codex"
      },
      "fallback": []
    }
  },
  "budget": {
    "period": "month",
    "limit": 100,
    "unit": "runCount"
  }
}
```

说明：

- `execution`：执行通道与工具绑定。
- `budget`：`agent + 周期` 配额策略。
- 后续可扩展更多命名空间（如 `review`、`ops`、`security`）。

## 执行计划

1. 数据模型改造
   - Agent Schema 增加 `config` 字段，默认 `{}`。
2. 接口契约扩展
   - `POST /agents`、`PUT /agents/:id` 增加 `config` 入参。
   - `GET /agents`、`GET /agents/:id` 返回 `config`。
3. 运行时解析入口
   - 执行前从 `agent.config.execution` 解析 provider/tool/endpoint/modelPolicy。
   - 保留现有门禁：角色准入、模型匹配、配额超限审批。
4. 兼容策略
   - 历史 Agent `config` 缺失时按默认策略运行。
5. 文档更新
   - 更新 Agent 功能文档与 agents-api。
   - 在 OpenCode 主计划中引用本计划。

## 关键影响点

- 后端：`apps/agents` 的 schema、DTO、controller、service。
- 运行时：OpenCode 执行前配置解析流程。
- 前端：Agent 创建/编辑页支持 `config` 输入。
- 文档：feature/api/plan 的字段说明统一。

## 风险与依赖

1. `config` 结构过于自由导致脏数据
   - 缓解：先做最小 JSON 结构校验 + 命名空间约定。
2. 历史 Agent 无 `config` 导致行为不一致
   - 缓解：默认策略与运行时兜底。
3. 多工具接入时配置冲突
   - 缓解：统一 `execution.provider` 主键 + 子命名空间隔离。

## 验收标准

1. 创建/更新 Agent 时可保存并返回 `config`。
2. 历史 Agent 不受影响（无 `config` 仍可正常运行）。
3. 运行时可读取 `config.execution` 并输出可审计解析结果。
4. 文档中可明确查询到 `config` 字段定义与示例。

## 后续讨论项

1. `config` 是否需要版本字段（如 `configVersion`）。
2. 前端是否分阶段从 JSON 编辑升级为结构化配置表单。
3. 是否需要配置变更审计（谁在何时修改了哪些配置键）。
