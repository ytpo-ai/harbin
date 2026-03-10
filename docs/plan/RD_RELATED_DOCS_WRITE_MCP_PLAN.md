# RD Related Docs Write MCP 接入计划

## 1. 需求理解

- 新增一个可执行“文档写入”的 MCP 工具，工具 ID 固定为 `builtin.sys-mg.internal.rd-related.docs-write`。
- 目标是让 Agent 能在仓库内自动写入研发文档，减少人工复制粘贴与手工维护成本。
- 默认安全边界采用最小权限：仅允许写入 `docs/**` 下的 Markdown 文档。

## 2. 执行步骤

1. 在 tools 内置工具注册表中新增 `docs-write` 定义（名称、描述、参数 schema、权限与分类）。
2. 在 `ToolService` 执行分发中接入 `docs-write` 路由，并补充 implemented tool id 清单。
3. 实现 `docs-write` 核心写入逻辑，支持 `create/update/append` 三种模式。
4. 增加输入校验与防护：路径穿越拦截、仅 `docs/**` 白名单、仅 `.md` 后缀、覆盖策略控制。
5. 补充单元测试，覆盖成功写入与典型失败场景（非法路径、非法后缀、覆盖冲突）。
6. 更新功能/API/日常进度文档，沉淀参数约定与安全约束。

## 3. 关键影响点

- 后端：`backend/apps/agents/src/modules/tools/tool.service.ts`
- 测试：`backend/apps/agents/src/modules/tools/tool.service.spec.ts`
- 功能文档：`docs/features/AGENT_TOOL.md`
- API 文档：`docs/api/agents-api.md`
- 日常进度：`docs/daily_logs/day/2026-03-11.md`

## 4. 风险与依赖

- 文档写入能力具备文件系统修改风险，必须严格执行目录与后缀白名单。
- `update/append` 场景对文件存在性敏感，需返回可操作的错误信息避免误覆盖。
- 依赖 agents 服务具备对目标工作区的写权限。
