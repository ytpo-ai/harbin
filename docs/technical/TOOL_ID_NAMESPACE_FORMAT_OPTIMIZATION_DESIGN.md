# Tool ID 命名结构优化设计

## 1. 目标与原则

### 1.1 目标

- 将工具 ID 统一为 5 段：`{provider}.{namespace}.{mcp|internal}.{toolkit}.{toolname}`。
- namespace 固定为 5 个业务域：`系统管理`、`通讯工具`、`WEB信息检索收集`、`数据分析`、`其他`。
- 明确研发相关工具归类：代码阅读、文档阅读、git log 分析统一到 `系统管理/RD Toolkit`。

### 1.2 设计原则

1. 业务语义优先：namespace 表达业务域，而不是实现方式。
2. 执行通道独立：`mcp|internal` 仅表达调用链路。
3. 强约束可治理：固定 5 段，禁止可变长度。
4. 兼容迁移：保留旧 ID 映射，逐步收敛。

## 2. 命名规范

### 2.1 结构定义

`{provider}.{namespace}.{mcp|internal}.{toolkit}.{toolname}`

| 段位 | 含义 | 约束 |
|------|------|------|
| provider | 工具来源平台 | `builtin` / `composio` / 其他注册 provider |
| namespace | 业务域 | 固定在 5 个枚举内 |
| mcp\|internal | 执行通道 | 仅允许 `mcp` 或 `internal` |
| toolkit | 工具包分组 | 领域内稳定分组，建议 kebab-case |
| toolname | 工具名 | 原子动作名，建议 camelCase |

### 2.2 namespace 枚举（业务语义）

| 中文业务域 | 建议 ID 存储值（slug） | 归类说明 |
|------------|-------------------------|----------|
| 系统管理 | `sys-mg` | 项目内管理、研发辅助、编排、会议、模型管理、审计、记忆 |
| 通讯工具 | `communication` | Slack、Gmail 等外部沟通类能力 |
| WEB信息检索收集 | `web-retrieval` | Web Search / Web Fetch / 信息抓取 |
| 数据分析 | `data-analysis` | 结构化提取、聚合、统计、分析 |
| 其他 | `other` | 临时或待归类工具（需后续收敛） |

说明：
- 业务沟通中可使用中文枚举；数据库和 API ID 建议使用 slug，避免编码与跨语言兼容问题。
- 若必须使用中文 namespace，需在网关与存储层补充 UTF-8 规范与大小写归一化策略。

### 2.3 关键归类规则

- 代码/文档阅读、git log 分析：`namespace=系统管理`，`toolkit=RD Toolkit`（ID 建议存储值：`rd-related`）。
- Slack/Gmail：`namespace=通讯工具`。
- Web 搜索与抓取：`namespace=WEB信息检索收集`。
- 内容结构化抽取：`namespace=数据分析`。

## 3. 现状问题（基于当前代码）

数据来源：`backend/apps/agents/src/modules/tools/tool.service.ts` 中 `initializeBuiltinTools` 与 `toolIdMapping`。

1. 当前主格式为 `provider.channel.namespace.resource(.action)`，与目标格式不一致。
2. 当前 ID 存在 4 段、5 段、6 段混用，不利于稳定解析。
3. 历史存在 `gh` 通道，与目标 `mcp|internal` 不一致。

## 4. 现有工具按命名级别罗列（按目标层级归类）

说明：以下为“现有工具”在目标层级下的归位清单，`建议新ID` 使用 slug 作为 namespace 存储值。

### 4.1 系统管理（sys-mg）

| 当前 ID | provider | channel | toolkit | toolname | 建议新 ID |
|---------|----------|---------|---------|----------|-----------|
| `builtin.internal.repo.read` | builtin | internal | rd | Repo Read With Bash | `builtin.sys-mg.internal.rd-related.repo-read` |
| `builtin.internal.docs.read` | builtin | internal | rd | Repo Docs Read | `builtin.sys-mg.internal.rd-related.repo-docs-read` |
| `builtin.internal.updates.read` | builtin | internal | rd | Repo Git Log Read | `builtin.sys-mg.internal.rd-related.repo-git-log-read` |
| `builtin.internal.agents.list` | builtin | internal | agent-master | List Agents | `builtin.sys-mg.internal.agent-master.list-agents` |
| `builtin.mcp.model.list` | builtin | mcp | model-admin | List LLM Models | `builtin.sys-mg.mcp.model-admin.list-llm-models` |
| `builtin.mcp.model.add` | builtin | mcp | model-admin | Add LLM Model | `builtin.sys-mg.mcp.model-admin.add-llm-model` |
| `builtin.internal.memo.search` | builtin | internal | memory | Search Memo | `builtin.sys-mg.internal.memory.search-memo` |
| `builtin.internal.memo.append` | builtin | internal | memory | Append Memo | `builtin.sys-mg.internal.memory.append-memo` |
| `builtin.mcp.humanOperationLog.list` | builtin | mcp | audit | List Human Operation Log | `builtin.sys-mg.mcp.audit.list-human-operation-log` |
| `builtin.mcp.orchestration.createPlan` | builtin | mcp | orchestration | Create Plan | `builtin.sys-mg.mcp.orchestration.create-plan` |
| `builtin.mcp.orchestration.runPlan` | builtin | mcp | orchestration | Run Plan | `builtin.sys-mg.mcp.orchestration.run-plan` |
| `builtin.mcp.orchestration.getPlan` | builtin | mcp | orchestration | Get Plan | `builtin.sys-mg.mcp.orchestration.get-plan` |
| `builtin.mcp.orchestration.listPlans` | builtin | mcp | orchestration | List Plans | `builtin.sys-mg.mcp.orchestration.list-plans` |
| `builtin.mcp.orchestration.reassignTask` | builtin | mcp | orchestration | Reassign Task | `builtin.sys-mg.mcp.orchestration.reassign-task` |
| `builtin.mcp.orchestration.completeHumanTask` | builtin | mcp | orchestration | Complete Human Task | `builtin.sys-mg.mcp.orchestration.complete-human-task` |
| `builtin.mcp.meeting.list` | builtin | mcp | meeting | List Meetings | `builtin.sys-mg.mcp.meeting.list-meetings` |
| `builtin.mcp.meeting.sendMessage` | builtin | mcp | meeting | Send Meeting Message | `builtin.sys-mg.mcp.meeting.send-message` |
| `builtin.mcp.meeting.updateStatus` | builtin | mcp | meeting | Update Meeting Status | `builtin.sys-mg.mcp.meeting.update-status` |

### 4.2 通讯工具（communication）

| 当前 ID | provider | channel | toolkit | toolname | 建议新 ID |
|---------|----------|---------|---------|----------|-----------|
| `composio.mcp.slack.sendMessage` | composio | mcp | slack | Send Message | `composio.communication.mcp.slack.send-message` |
| `composio.mcp.gmail.sendEmail` | composio | mcp | gmail | Send Gmail | `composio.communication.mcp.gmail.send-email` |

### 4.3 WEB信息检索收集（web-retrieval）

| 当前 ID | provider | channel | toolkit | toolname | 建议新 ID |
|---------|----------|---------|---------|----------|-----------|
| `builtin.internal.web.search.exa` | builtin | internal | web-search | Web Search EXA | `builtin.web-retrieval.internal.web-search.exa` |
| `composio.mcp.web.search.serp` | composio | mcp | web-search | Web Search SERP | `composio.web-retrieval.mcp.web-search.serp` |
| `builtin.internal.web.fetch` | builtin | internal | web-fetch | Web Fetch | `builtin.web-retrieval.internal.web-fetch.fetch` |

### 4.4 数据分析（data-analysis）

| 当前 ID | provider | channel | toolkit | toolname | 建议新 ID |
|---------|----------|---------|---------|----------|-----------|
| `builtin.internal.content.extract` | builtin | internal | content-analysis | Content Extract | `builtin.data-analysis.internal.content-analysis.extract` |

### 4.5 其他（other）

当前内置工具暂无落入 `other` 的必要项。

## 5. 兼容与迁移建议

### 5.1 迁移策略

1. 增加 `canonicalIdV2` 字段，写入新 5 段式 ID。
2. 旧 `canonicalId` 保留一个版本周期，通过映射表解析。
3. API 返回同时提供：`toolId`(v2) 与 `legacyToolId`(v1)。

### 5.2 兼容映射最低要求

- 覆盖 `toolIdMapping` 里的全部历史 ID。
- 增加 `gh -> mcp` 通道并轨规则。
- 对 6 段式历史 ID 执行 flatten（`resource.action` -> `toolkit.toolname`）。

### 5.3 校验规则

- 正则建议：`^[a-z0-9-]+\.[a-z0-9-]+\.(mcp|internal)\.[a-z0-9-]+\.[a-zA-Z0-9]+$`
- namespace 必须属于预置字典。
- 仅允许 5 段，禁止多段 action 拼接。

## 6. 示例

| 场景 | 示例 ID |
|------|---------|
| 研发文档总结（MCP） | `builtin.sys-mg.mcp.rd-related.docsSummary` |
| 研发 git log 读取（内部） | `builtin.sys-mg.internal.rd-related.gitLogRead` |
| Slack 发送消息 | `composio.communication.mcp.slack.sendMessage` |
| Exa 网页搜索 | `builtin.web-retrieval.internal.web-search.exa` |
| 内容结构化提取 | `builtin.data-analysis.internal.content-analysis.extract` |
