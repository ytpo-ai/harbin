# Tool ID 命名结构优化计划

> 目标：将工具 ID 统一到 `provider.namespace.{mcp|internal}.toolkit.toolname`，并将 namespace 收敛为固定业务域。

## 1. 需求范围

- 统一 Tool ID 结构，消除当前 `provider/channel/namespace` 混用问题。
- namespace 固定为：`系统管理`、`通讯工具`、`WEB信息检索收集`、`数据分析`、`其他`。
- 明确“代码/文档阅读、git log 分析”归属：`namespace=系统管理` + `toolkit=RD Toolkit`。
- 先完成文档：输出命名规范、迁移建议、现有工具按层级清单。

## 2. 执行步骤

1. 梳理现状：基于 `tool.service.ts` 抽取当前内置工具与 legacy 映射。
2. 设计目标规范：定义 5 段式 ID 规则、字段约束、命名边界。
3. 定义 namespace 字典：给出中文业务域与 ID 存储值（slug）映射。
4. 给出迁移规则：提供旧 ID -> 新 ID 映射策略与兼容方案。
5. 输出现有工具清单：按 `provider > namespace > channel > toolkit > toolname` 罗列。
6. 更新功能文档引用：在 `AGENT_TOOL` 功能文档挂接该方案文档。

## 3. 关键影响点

- 后端：`Tool/Toolkit` 注册、筛选、统计字段口径统一。
- 前端：工具管理页分组与筛选维度对齐新 namespace。
- 治理：MCP Profile 白名单按统一层级授权。
- 文档：工具命名、迁移策略、兼容窗口可追踪。

## 4. 风险与依赖

- 部分历史 ID 为 4 段/6 段，需 flatten 或补全。
- `gh` 当前作为 channel 的历史值需并轨到 `{mcp|internal}`。
- 若外部系统已绑定旧 ID，需保留 alias 和映射表。

## 5. 验收标准（文档阶段）

- [ ] 输出完整 ID 命名规范（含字段约束和示例）
- [ ] 输出 namespace 固定字典与判定规则
- [ ] 输出现有工具按新层级归类清单
- [ ] 输出旧 ID -> 新 ID 的建议映射与兼容策略
- [ ] 在功能文档中建立引用关系
