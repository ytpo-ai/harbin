# Tool Prompt 注入改造计划

> 状态：进行中
> 更新时间：2026-03-10

## 1. 需求目标

将“工具使用策略提示”从 `agent.service.ts` 中的角色/场景硬编码，升级为“工具级配置驱动”：

1. 在 Tool 模型增加可选 `prompt` 字段。
2. Agent 拥有某工具时，若该工具配置了 `prompt`，则自动注入 session 的 system 消息。
3. 注入逻辑以“工具权限”为准，不依赖角色分支。
4. 提供迁移脚本，将现有硬编码策略批量写回工具数据库。

## 2. 执行步骤

1. **数据模型扩展**
   - 为 `Tool` schema 与共享 `Tool` 类型新增 `prompt?: string`。
   - 校验 create/update 流程可透传该字段。

2. **运行时注入改造**
   - 在 Agent 消息构建链路中按 `allowedToolIds` 对应工具收集 `prompt`。
   - 统一写入 system 消息并复用现有 session 侧去重。

3. **去角色化策略下沉**
   - 将当前与特定工具相关的规则文本迁移到工具配置，不再在 `agent.service.ts` 按角色写死。

4. **历史数据迁移脚本**
   - 新增脚本按 canonical tool id 批量 upsert `prompt`。
   - 支持 dry-run 预览。

5. **验证与文档**
   - 补充/更新测试：工具 prompt 注入、空 prompt 忽略、重复去重。
   - 更新 `docs/feature/AGENT_TOOL.md`、`docs/feature/AGENT_RUNTIME.md` 与开发总结。

## 3. 关键影响点

- 后端：`tools` schema、tools API、`agent.service.ts` 消息组装、runtime session 消息写入。
- 数据库：`tools` 集合新增 `prompt` 字段内容。
- 文档：功能文档与开发总结同步。

## 4. 风险与约束

- 多工具同时注入可能导致上下文膨胀，需要长度控制与稳定排序。
- 工具提示冲突风险：先按“就近工具职责”编写，避免跨工具互相覆盖。
- 迁移脚本需支持 dry-run，避免误写生产数据。
